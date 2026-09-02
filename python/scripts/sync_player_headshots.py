"""Resolves the portrait each card actually shows.

The card pool has always read its picture from NflWeeklyStat.headshot, which is
nflverse's `headshot_url` — an nfl.com Cloudinary link. Roughly half of those
links answer **200 with the league's generic faceless-helmet silhouette** rather
than a photograph of the player. Two consequences, both invisible until you look
at a card:

  * "headshot IS NOT NULL" never meant "there is a picture". By that measure
    coverage looked complete back to 1999; by eye, half the deck was helmets.

  * Because the silhouette arrives as a 200 and not a 404, PlayerCard's onError
    fallback never fired, so those cards could not fall back to a team logo
    either. A black helmet is what a member saw.

This job answers the real question — what should this player's card show? — and
writes it to NflPlayerHeadshot:

  1. Fetch nfl.com's image and fingerprint it. Anything that is the silhouette
     is treated as no picture at all.
  2. For those, cross-reference the player's espn_id from nflverse's player
     table and try ESPN's headshot CDN, which covers most of 2009 onward and
     tapers off before that. ESPN 404s what it does not have, so a 200 there is
     a real photograph.
  3. For anyone still unresolved, ask English Wikipedia for the player's article
     image. This is the only source that reaches pre-2009 players at all —
     measured against the 942 players the first two steps could not place, it
     recovered 22%, including most of the well-known ones (Edgerrin James,
     Eddie George, Warrick Dunn). See wikipedia_photos for why it is matched on
     the article description rather than on the name alone.
  4. Whatever is left is written as a NULL url with source NONE, which is what
     lets the card fall back to its team logo — the honest answer for a 2003
     role player nobody photographed.

Safe to re-run: rows are upserted on playerId, nothing is truncated. By default
only players with no row yet, and those previously resolved to NONE, are
checked — a photograph that was found once does not stop being one, while ESPN
and Wikipedia both gain portraits for older players over time.

Note on licensing: Wikimedia Commons images are freely licensed, but most are
CC-BY-SA and carry an attribution requirement. The source is recorded per row so
the league can attribute them if it ever publishes the cards outside itself.

Usage:
  python scripts/sync_player_headshots.py           # new and unresolved players
  python scripts/sync_player_headshots.py --all     # re-check every player

Env:
  TURSO_DATABASE_URL, TURSO_AUTH_TOKEN — database credentials
"""
from __future__ import annotations

import concurrent.futures
import hashlib
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

import certifi
import nflreadpy as nfl

from common import localenv, net, syncrun, turso

# Positions the card pool builds cards for. Checking anyone else would be a few
# thousand pointless requests — see src/lib/cards/pool.ts.
CARD_POSITIONS = ("QB", "RB", "WR", "TE")

NFL_HOST = "static.www.nfl.com"
ESPN_HOST = "a.espncdn.com"

# nfl.com serves its images through Cloudinary, and nflverse's URLs carry the
# `f_auto,q_auto` transformation. Swapping that for a fixed 32x32 PNG is what
# makes this job affordable *and* what makes it exact:
#
#   * Affordable — 6 KB a player instead of 160 KB, so checking the whole pool
#     moves about 24 MB rather than half a gigabyte.
#
#   * Exact — the silhouette is one source image published under ~1,800
#     different public ids, so its full-size encoding varies but its thumbnail
#     is byte-identical every time. Fingerprinting the thumbnail identifies it
#     with no size heuristic and no per-id blocklist to maintain.
#
# f_png and q_100 pin the format and quality so the digest cannot drift with
# content negotiation.
THUMBNAIL_TRANSFORM = "w_32,h_32,c_fill,f_png,q_100"
SOURCE_TRANSFORM = "f_auto,q_auto"

# md5 of that 32x32 thumbnail of the generic faceless-helmet silhouette.
#
# Verified against all 3,555 distinct headshot URLs in the pool: it matched
# 1,829 of them and nothing else — every real photograph hashed uniquely. If
# the league ever redraws the placeholder this constant is what needs updating,
# and the symptom will be the helmet returning to the cards.
NFL_PLACEHOLDER_DIGEST = "352ec2252973f31df26aaafaef9e095f"

# ESPN publishes at a single predictable path and 404s what it does not hold,
# so a 200 needs no fingerprinting.
ESPN_HEADSHOT = "https://a.espncdn.com/i/headshots/nfl/players/full/{espn_id}.png"

# English Wikipedia's Action API. Used rather than the nicer-looking REST
# summary endpoint for one reason: it takes up to 50 titles per request. The
# REST endpoint is one request per player and rate-limits hard — measured, it
# returned HTTP 429 for most of a 60-player sample even issued serially with a
# quarter-second gap. Batched, the whole backlog is about twenty requests.
WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_HOST = "en.wikipedia.org"

# Titles per Action API request. 50 is the documented limit for anonymous
# clients; asking for more silently truncates rather than erroring.
WIKIPEDIA_BATCH = 50

# Width to request. The card renders at most ~320px wide, so 500 covers the
# hero in the pack opener with room for a high-DPI screen and nothing beyond.
WIKIPEDIA_THUMB_PX = 500

# Words that mark a Wikipedia article as being about the right person.
#
# This check is what makes the lookup safe. Matching on name alone is actively
# wrong: "Greg Clark" resolves to a British Conservative politician, whose
# portrait would then be printed on a tight end's card. Every candidate article
# has to describe a footballer before its image is accepted.
FOOTBALL_WORDS = (
    "football",
    "nfl",
    "quarterback",
    "running back",
    "wide receiver",
    "tight end",
)

# Tried in order for each player. The bare name is right for most, and the
# parenthetical is Wikipedia's own disambiguation convention for the rest.
WIKIPEDIA_TITLE_FORMS = ("{name}", "{name} (American football)")

# Wikipedia asks for a descriptive agent with a contact route. The pause is
# courtesy rather than a documented limit — twenty requests is a trivial load,
# and this keeps the job a well-behaved client of a donated service.
WIKIPEDIA_USER_AGENT = (
    "commissioner-suite/1.0 (fantasy league card game; "
    "https://github.com/ScottJohnson63/commissioner-suite)"
)
WIKIPEDIA_PAUSE_SECONDS = 0.3
WIKIPEDIA_RETRIES = 4

# Unlike the Turso uploads in common/turso.py — where parallel requests measured
# *slower* because the bottleneck is upload throughput — this job downloads
# small files from two CDNs, so latency is the constraint and concurrency is a
# genuine win. Kept modest to stay a well-behaved client.
WORKERS = 16
TIMEOUT_SECONDS = 30

_CONTEXT = ssl.create_default_context(cafile=certifi.where())


def thumbnail_url(headshot: str) -> str:
    """The 32x32 PNG form of an nfl.com headshot URL."""
    return headshot.replace(f"/{SOURCE_TRANSFORM}/", f"/{THUMBNAIL_TRANSFORM}/", 1)


def _fetch(url: str, host: str, *, method: str = "GET") -> tuple[int, bytes]:
    """One request, returning its status and body. Never raises for HTTP status."""
    request = urllib.request.Request(
        # The URL is built from a database column or a constant, and the host is
        # pinned to the CDN this call is for, so a rewritten feed cannot redirect
        # the job somewhere else.
        net.require_https(url, allowed_host=host),
        method=method,
        headers={"User-Agent": "commissioner-suite/1.0", "Accept": "image/png,*/*"},
    )
    try:
        # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
        # require_https above pins scheme and host. See tests/test_net.py.
        with urllib.request.urlopen(
            request, timeout=TIMEOUT_SECONDS, context=_CONTEXT
        ) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, b""
    except Exception:
        # A transient failure must not be recorded as "this player has no
        # photograph" — see resolve(), which leaves such players alone.
        return 0, b""


def nfl_photo(headshot: str | None) -> str | None:
    """`headshot` if it really is a photograph, else None.

    None covers all three ways nfl.com can fail to have a picture: no URL at
    all, a URL serving the generic silhouette, and a URL that errors.
    """
    if not headshot or f"/{SOURCE_TRANSFORM}/" not in headshot:
        return None

    status, body = _fetch(thumbnail_url(headshot), NFL_HOST)
    if status != 200 or not body:
        return None
    if hashlib.md5(body).hexdigest() == NFL_PLACEHOLDER_DIGEST:
        return None
    return headshot


def espn_photo(espn_id: str | None) -> str | None:
    """ESPN's portrait for a player, or None when it does not hold one."""
    if not espn_id:
        return None

    url = ESPN_HEADSHOT.format(espn_id=espn_id)
    status, _ = _fetch(url, ESPN_HOST, method="HEAD")
    return url if status == 200 else None


def _is_footballer(description: str | None) -> bool:
    """Whether a Wikipedia article describes an American football player.

    Wikipedia's short description is the cheapest reliable signal — "American
    football player (born 1972)" — and it is present on essentially every
    biography. Without this check the job would print a British politician on
    Greg Clark's card; with it, a wrong-person match is dropped rather than
    guessed at.
    """
    blob = (description or "").lower()
    return any(word in blob for word in FOOTBALL_WORDS)


def _wikipedia_query(titles: list[str]) -> dict | None:
    """One batched Action API call, or None when it could not be completed.

    Retries 429 and 503 with a widening pause: Wikipedia sheds load rather than
    queueing, so a refusal means "come back", not "no such page". Returning None
    for an exhausted retry matters — see wikipedia_photos, where an unanswered
    batch must leave its players unresolved rather than marking them NONE.
    """
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "prop": "pageimages|description",
        "piprop": "thumbnail",
        "pithumbsize": str(WIKIPEDIA_THUMB_PX),
        # Follow renames, so "Chad Johnson" reaches the article it redirects to.
        "redirects": "1",
        "titles": "|".join(titles),
    }
    url = f"{WIKIPEDIA_API}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(
        net.require_https(url, allowed_host=WIKIPEDIA_HOST),
        headers={"User-Agent": WIKIPEDIA_USER_AGENT, "Accept": "application/json"},
    )

    for attempt in range(WIKIPEDIA_RETRIES):
        try:
            # nosemgrep: python.lang.security.audit.dynamic-urllib-use-detected
            # require_https above pins scheme and host. See tests/test_net.py.
            with urllib.request.urlopen(
                request, timeout=TIMEOUT_SECONDS, context=_CONTEXT
            ) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as e:
            if e.code not in (429, 503):
                return None
        except Exception:
            pass
        time.sleep(WIKIPEDIA_PAUSE_SECONDS * (attempt + 1) * 2)

    return None


def _clean_thumbnail_url(url: str) -> str:
    """Strips Wikipedia's analytics query from a Commons URL.

    The API appends `?utm_source=…&utm_campaign=api&utm_content=…` to every
    thumbnail it hands back. The image serves identically without it, and the
    card has no reason to send a campaign beacon to Wikimedia every time
    somebody opens their deck — so the query is dropped before it is stored.
    """
    return url.split("?", 1)[0]


def _thumbnails(payload: dict | None) -> dict[str, str]:
    """Article title → thumbnail URL, for the pages in one API response.

    Titles are lowercased because the API normalises capitalisation and follows
    redirects, so the title that comes back is often not the one that was asked
    for. Pages that are missing, are about someone else, or simply have no lead
    image are dropped here rather than by the caller.
    """
    found: dict[str, str] = {}
    if not payload:
        return found

    for page in payload.get("query", {}).get("pages", []) or []:
        if page.get("missing") or not _is_footballer(page.get("description")):
            continue
        thumbnail = (page.get("thumbnail") or {}).get("source")
        if thumbnail:
            found[str(page.get("title", "")).lower()] = _clean_thumbnail_url(thumbnail)

    # Redirects are reported separately, so map the requested title onto the
    # article that answered it.
    for hop in payload.get("query", {}).get("redirects", []) or []:
        landed = found.get(str(hop.get("to", "")).lower())
        if landed:
            found[str(hop.get("from", "")).lower()] = landed

    return found


def wikipedia_photos(names: dict[str, str]) -> dict[str, str]:
    """Player id → Wikimedia portrait, for as many of `names` as have one.

    Two passes, because Wikipedia's disambiguation is inconsistent: most players
    sit at their plain name, but anyone sharing it with a more famous namesake
    sits at "<name> (American football)". Trying the plain form first and the
    parenthetical only for what is left keeps the request count near the
    theoretical minimum — one batch per fifty players per form.

    A player whose batch could not be fetched at all is simply absent from the
    result, which the caller treats as unresolved rather than as "no photograph".
    """
    remaining = dict(names)
    photos: dict[str, str] = {}

    for form in WIKIPEDIA_TITLE_FORMS:
        if not remaining:
            break

        titles = {
            player_id: form.format(name=name) for player_id, name in remaining.items()
        }
        ordered = list(titles.items())

        for start in range(0, len(ordered), WIKIPEDIA_BATCH):
            batch = ordered[start : start + WIKIPEDIA_BATCH]
            found = _thumbnails(_wikipedia_query([title for _, title in batch]))
            for player_id, title in batch:
                thumbnail = found.get(title.lower())
                if thumbnail:
                    photos[player_id] = thumbnail
            time.sleep(WIKIPEDIA_PAUSE_SECONDS)

        remaining = {p: n for p, n in remaining.items() if p not in photos}

    return photos


def players_to_check(check_all: bool) -> list[dict[str, str | None]]:
    """Card-pool players and their nfl.com URL, newest season's value winning.

    A player's headshot is the same picture in every season he played, so the
    grain collapses to one row per player. `headshot` is a bare column beside a
    MAX aggregate, which SQLite resolves to the value from the row that supplied
    the maximum — the newest season\'s URL, deterministically, rather than an
    arbitrary one if the feed ever disagrees with itself. The same trick picks a
    card\'s final team in src/lib/cards/pool.ts.
    """
    positions = ", ".join(f"'{p}'" for p in CARD_POSITIONS)
    already_resolved = (
        ""
        if check_all
        else """
       AND s."playerId" NOT IN (
             SELECT "playerId" FROM "NflPlayerHeadshot" WHERE "source" <> 'NONE'
           )"""
    )
    rows = turso.query(
        f"""
        SELECT s."playerId" AS "playerId",
               MAX(s."season"),
               s."headshot"    AS "headshot"
          FROM "NflWeeklyStat" s
         WHERE s."position" IN ({positions}){already_resolved}
         GROUP BY s."playerId"
        """
    )
    return [{"playerId": r["playerId"], "headshot": r["headshot"]} for r in rows]


def player_index() -> tuple[dict[str, str], dict[str, str]]:
    """(GSIS id → ESPN id, GSIS id → display name), from nflverse's players.

    One read serving both lookups. nflverse already carries espn_id and
    display_name beside the gsis_id the stat table is keyed on, so neither the
    ESPN step nor the Wikipedia step introduces a feed of its own.

    The two maps are returned separately rather than as one record because they
    are not populated for the same players: a 1999 receiver reliably has a name
    and often has no espn_id.
    """
    frame = nfl.load_players().select(["gsis_id", "espn_id", "display_name"])
    rows = [r for r in frame.to_dicts() if r["gsis_id"]]
    return (
        {r["gsis_id"]: str(r["espn_id"]) for r in rows if r["espn_id"]},
        {r["gsis_id"]: str(r["display_name"]) for r in rows if r["display_name"]},
    )


def resolve(
    player: dict[str, str | None], by_gsis: dict[str, str]
) -> tuple[str, str | None, str]:
    """One player's (id, url, source) from the two per-player CDN lookups.

    Wikipedia is deliberately not tried here. It is batched fifty players to a
    request, which does not fit a function called once per player from a thread
    pool — main() runs it afterwards over whatever this leaves as NONE.
    """
    player_id = str(player["playerId"])

    photo = nfl_photo(player["headshot"])
    if photo:
        return player_id, photo, "NFL"

    photo = espn_photo(by_gsis.get(player_id))
    if photo:
        return player_id, photo, "ESPN"

    return player_id, None, "NONE"


def apply_wikipedia(
    resolved: list[tuple[str, str | None, str]], names: dict[str, str]
) -> list[tuple[str, str | None, str]]:
    """Fills in NONE rows from Wikipedia, leaving everything else untouched.

    Runs last because it is the weakest source: an article portrait is whatever
    photograph someone uploaded, which may be a player in another team's
    uniform or twenty years after the season on the card. That is still worth
    far more than a team logo, but not more than nfl.com's own headshot.
    """
    unresolved = {
        player_id: names[player_id]
        for player_id, _, source in resolved
        if source == "NONE" and player_id in names
    }
    if not unresolved:
        return resolved

    print(f"Asking Wikipedia about {len(unresolved)} player(s) with no CDN photo…")
    photos = wikipedia_photos(unresolved)
    print(f"  recovered {len(photos)}")

    return [
        (player_id, photos[player_id], "WIKIPEDIA")
        if source == "NONE" and player_id in photos
        else (player_id, url, source)
        for player_id, url, source in resolved
    ]


def upsert(resolved: list[tuple[str, str | None, str]]) -> int:
    """Writes one row per player, keyed on playerId."""
    sql = (
        'INSERT INTO "NflPlayerHeadshot" (id, "playerId", "url", "source", "checkedAt") '
        "VALUES (lower(hex(randomblob(16))), ?, ?, ?, CURRENT_TIMESTAMP) "
        'ON CONFLICT ("playerId") DO UPDATE SET '
        '"url" = excluded."url", "source" = excluded."source", '
        '"checkedAt" = CURRENT_TIMESTAMP'
    )
    return turso.execute_chunked(sql, resolved, label="headshot rows")


def main() -> None:
    check_all = "--all" in sys.argv[1:]
    if [a for a in sys.argv[1:] if a != "--all"]:
        raise SystemExit(__doc__)

    # Fail on a missing credential now, not after the player table has downloaded.
    localenv.require("TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN")

    with syncrun.record(syncrun.NFL_WEEKLY) as run:
        players = players_to_check(check_all)
        if not players:
            run.skip("every card-pool player already has a resolved headshot")
            print("Nothing to check — every player is already resolved.")
            return

        print(f"Checking {len(players)} player(s)…")
        by_gsis, names = player_index()

        with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
            resolved = list(pool.map(lambda p: resolve(p, by_gsis), players))

        resolved = apply_wikipedia(resolved, names)

        counts = {"NFL": 0, "ESPN": 0, "WIKIPEDIA": 0, "NONE": 0}
        for _, _, source in resolved:
            counts[source] += 1

        written = upsert(resolved)
        run.note(
            operation="headshots",
            checked=len(players),
            from_nfl=counts["NFL"],
            from_espn=counts["ESPN"],
            from_wikipedia=counts["WIKIPEDIA"],
            no_photo=counts["NONE"],
        )
        run.count(written)

        print(
            f"✓ Headshot sync complete — {counts['NFL']} from nfl.com, "
            f"{counts['ESPN']} recovered from ESPN, "
            f"{counts['WIKIPEDIA']} from Wikipedia, {counts['NONE']} with no "
            f"photograph anywhere (those cards show their team logo)."
        )


if __name__ == "__main__":
    main()
