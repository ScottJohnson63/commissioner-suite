"""Covers the headshot resolver in scripts/sync_player_headshots.py.

The whole job turns on one judgement — "is this URL a photograph, or is it the
league's generic silhouette?" — and getting it wrong is silent in both
directions: a false positive puts a black helmet back on a card, a false
negative throws away a picture the game had. Both are pinned here.

The second judgement is the licence. A Wikimedia portrait is free to show and
not free to show *uncredited*, so the attribution this job records is covered
with the same care: where it comes from, what it is stripped of before it is
stored, and — the one that is not cosmetic — that a file which is not on
Commons never reaches a card at all.
"""
from __future__ import annotations

import hashlib

import pytest

import sync_player_headshots as headshots

NFL_URL = "https://static.www.nfl.com/image/private/f_auto,q_auto/league/abc123"
UPLOAD_URL = "https://static.www.nfl.com/image/upload/f_auto,q_auto/league/xyz789"

# Bytes whose md5 is the recorded placeholder digest, so the test exercises the
# real comparison rather than a stubbed one.
PLACEHOLDER_BYTES = b"the-generic-faceless-helmet"
PHOTOGRAPH_BYTES = b"an-actual-photograph"

# A real Commons thumbnail URL, in the shape the pageimages API returns. Used
# rather than a made-up "https://u/e.jpg" because the path is now load-bearing:
# _page_images drops anything not under /wikipedia/commons/, and the file name
# is read back out of this URL.
COMMONS_THUMB = (
    "https://upload.wikimedia.org/wikipedia/commons/thumb/8/8a/"
    "Eddie_George.jpg/500px-Eddie_George.jpg"
)


@pytest.fixture(autouse=True)
def placeholder_digest(monkeypatch):
    """Points the constant at PLACEHOLDER_BYTES for the duration of a test."""
    monkeypatch.setattr(
        headshots,
        "NFL_PLACEHOLDER_DIGEST",
        hashlib.md5(PLACEHOLDER_BYTES).hexdigest(),
    )


def fetches(responses):
    """A _fetch stand-in returning canned (status, body) keyed on URL."""
    def _fetch(url, host, *, method="GET"):
        return responses[url]
    return _fetch


class TestThumbnailUrl:
    # WHY: the whole cost and accuracy argument rests on this rewrite. If the
    #      transformation segment stops being substituted the job downloads
    #      full-size images and hashes encodings that vary per URL, so every
    #      placeholder silently becomes "a photograph".
    def test_swaps_the_transformation_for_a_fixed_thumbnail(self):
        assert headshots.thumbnail_url(NFL_URL) == (
            "https://static.www.nfl.com/image/private/"
            "w_32,h_32,c_fill,f_png,q_100/league/abc123"
        )

    # WHY: nflverse emits both /image/private/ and /image/upload/ delivery
    #      paths, and both carry placeholders. Rewriting only one would leave
    #      that whole family unchecked.
    def test_handles_the_upload_delivery_path(self):
        assert "w_32,h_32,c_fill,f_png,q_100" in headshots.thumbnail_url(UPLOAD_URL)


class TestNflPhoto:
    def test_keeps_a_url_serving_a_real_photograph(self, monkeypatch):
        monkeypatch.setattr(headshots, "_fetch", fetches(
            {headshots.thumbnail_url(NFL_URL): (200, PHOTOGRAPH_BYTES)},
        ))
        assert headshots.nfl_photo(NFL_URL) == NFL_URL

    # WHY: the bug this job exists for. The silhouette arrives as a 200, so
    #      status alone calls it a picture and the card renders a black helmet.
    def test_rejects_the_generic_silhouette_despite_the_200(self, monkeypatch):
        monkeypatch.setattr(headshots, "_fetch", fetches(
            {headshots.thumbnail_url(NFL_URL): (200, PLACEHOLDER_BYTES)},
        ))
        assert headshots.nfl_photo(NFL_URL) is None

    def test_rejects_a_missing_url(self):
        assert headshots.nfl_photo(None) is None
        assert headshots.nfl_photo("") is None

    def test_rejects_an_error_response(self, monkeypatch):
        monkeypatch.setattr(headshots, "_fetch", fetches(
            {headshots.thumbnail_url(NFL_URL): (404, b"")},
        ))
        assert headshots.nfl_photo(NFL_URL) is None


class TestEspnPhoto:
    def test_returns_the_cdn_url_when_espn_holds_one(self, monkeypatch):
        url = headshots.ESPN_HEADSHOT.format(espn_id="1755")
        monkeypatch.setattr(headshots, "_fetch", fetches({url: (200, b"")}))
        assert headshots.espn_photo("1755") == url

    # WHY: ESPN genuinely 404s players it has no portrait for — mostly retired
    #      pre-2009 ones — and that must become "no photograph", not a URL that
    #      breaks on the card.
    def test_returns_nothing_on_a_404(self, monkeypatch):
        url = headshots.ESPN_HEADSHOT.format(espn_id="1755")
        monkeypatch.setattr(headshots, "_fetch", fetches({url: (404, b"")}))
        assert headshots.espn_photo("1755") is None

    def test_returns_nothing_without_an_espn_id(self):
        assert headshots.espn_photo(None) is None


class TestResolve:
    # WHY: nfl.com is preferred where it has a real picture — its images are
    #      higher resolution than ESPN's, so ESPN is a fallback and not a
    #      replacement.
    def test_prefers_nfl_when_it_has_a_photograph(self, monkeypatch):
        monkeypatch.setattr(headshots, "_fetch", fetches(
            {headshots.thumbnail_url(NFL_URL): (200, PHOTOGRAPH_BYTES)},
        ))
        assert headshots.resolve(
            {"playerId": "00-0001", "headshot": NFL_URL}, {"00-0001": "1755"},
        ) == headshots.Resolved("00-0001", NFL_URL, "NFL")

    # WHY: the recovery path — roughly 3,900 cards whose nfl.com link is the
    #      silhouette but whose ESPN portrait exists.
    def test_falls_back_to_espn_when_nfl_is_a_silhouette(self, monkeypatch):
        espn = headshots.ESPN_HEADSHOT.format(espn_id="1755")
        monkeypatch.setattr(headshots, "_fetch", fetches({
            headshots.thumbnail_url(NFL_URL): (200, PLACEHOLDER_BYTES),
            espn: (200, b""),
        }))
        assert headshots.resolve(
            {"playerId": "00-0001", "headshot": NFL_URL}, {"00-0001": "1755"},
        ) == headshots.Resolved("00-0001", espn, "ESPN")

    # WHY: a null url is a real answer, not a failure. It is what tells the
    #      card to draw its team logo, which is the point of the whole change.
    def test_records_no_photograph_when_neither_source_has_one(self, monkeypatch):
        espn = headshots.ESPN_HEADSHOT.format(espn_id="1755")
        monkeypatch.setattr(headshots, "_fetch", fetches({
            headshots.thumbnail_url(NFL_URL): (200, PLACEHOLDER_BYTES),
            espn: (404, b""),
        }))
        assert headshots.resolve(
            {"playerId": "00-0001", "headshot": NFL_URL}, {"00-0001": "1755"},
        ) == headshots.Resolved("00-0001", None, "NONE")

    # WHY: the CDN sources are the league's and the network's own pictures, used
    #      as those feeds publish them. Writing a credit against one would
    #      attribute an nfl.com headshot to whoever last uploaded to Commons.
    def test_records_no_credit_for_a_cdn_photograph(self, monkeypatch):
        monkeypatch.setattr(headshots, "_fetch", fetches(
            {headshots.thumbnail_url(NFL_URL): (200, PHOTOGRAPH_BYTES)},
        ))
        resolved = headshots.resolve(
            {"playerId": "00-0001", "headshot": NFL_URL}, {"00-0001": "1755"},
        )
        assert resolved.credit == headshots.NO_CREDIT


class TestIsFootballer:
    # WHY: this is the guard that makes a name-based lookup safe at all.
    #      Wikipedia's "Greg Clark" is a British Conservative politician, and
    #      without this check his portrait would be printed on a tight end's
    #      card. Measured on a real sample, name collisions hit 3% of players.
    def test_rejects_a_page_about_someone_else(self):
        assert not headshots._is_footballer("British Conservative politician")

    def test_accepts_an_american_football_player(self):
        assert headshots._is_footballer("American football player (born 1972)")

    # WHY: position-only descriptions are common on older articles, which are
    #      exactly the players this source exists to reach.
    def test_accepts_a_position_only_description(self):
        assert headshots._is_footballer("American quarterback")

    # WHY: a missing short description must not be read as a match. Failing
    #      open here would reintroduce the collision this class exists to stop.
    def test_rejects_a_missing_description(self):
        assert not headshots._is_footballer(None)
        assert not headshots._is_footballer("")


class TestPageImages:
    def _page(self, title, description, thumb, name=None):
        page = {"title": title, "description": description}
        if thumb:
            page["thumbnail"] = {"source": thumb}
        if name:
            page["pageimage"] = name
        return page

    # WHY: the API normalises capitalisation, so the title that comes back is
    #      often not the one asked for. Keying on the lowercased title is what
    #      lets the caller find its player again.
    def test_keys_on_the_lowercased_title(self):
        payload = {"query": {"pages": [
            self._page("Eddie George", "American football player", COMMONS_THUMB),
        ]}}
        assert headshots._page_images(payload) == {
            "eddie george": headshots.PageImage(COMMONS_THUMB, "Eddie_George.jpg"),
        }

    # WHY: the file name is the only handle on the file itself — the thumbnail
    #      URL cannot be turned into an API query — so losing it loses the
    #      credit, and a CC BY-SA picture with no credit is the one outcome
    #      this whole change exists to prevent.
    def test_carries_the_file_name_from_the_api(self):
        payload = {"query": {"pages": [
            self._page("Eddie George", "American football player", COMMONS_THUMB,
                       name="Eddie_George_2015.jpg"),
        ]}}
        assert headshots._page_images(payload)["eddie george"].file == (
            "Eddie_George_2015.jpg"
        )

    # WHY: `piprop=name` is a recent addition to this query, and a response
    #      without it must still yield a usable file name rather than a
    #      portrait nobody can credit. The URL already carries one.
    def test_falls_back_to_the_name_in_the_url(self):
        payload = {"query": {"pages": [
            self._page("Eddie George", "American football player", COMMONS_THUMB),
        ]}}
        assert headshots._page_images(payload)["eddie george"].file == "Eddie_George.jpg"

    # WHY: **the licence guard.** English Wikipedia hosts its non-free files
    #      locally under /wikipedia/en/ — logos, album art, fair-use publicity
    #      shots. `pilicense=free` should keep them out of this response; if it
    #      ever does not, printing one on a card is a licence breach rather
    #      than a cosmetic bug.
    def test_drops_an_image_that_is_not_on_commons(self):
        payload = {"query": {"pages": [
            self._page("Eddie George", "American football player",
                       "https://upload.wikimedia.org/wikipedia/en/5/5a/Fair_use.jpg"),
        ]}}
        assert headshots._page_images(payload) == {}

    # WHY: a page with no lead image is not a photograph. Returning the article
    #      anyway would write a null url under a WIKIPEDIA source, which reads
    #      as "we found one" everywhere downstream.
    def test_drops_a_page_with_no_image(self):
        payload = {"query": {"pages": [
            self._page("Milton Wynn", "American football player", None),
        ]}}
        assert headshots._page_images(payload) == {}

    def test_drops_a_page_about_someone_else(self):
        payload = {"query": {"pages": [
            self._page("Greg Clark", "British Conservative politician", COMMONS_THUMB),
        ]}}
        assert headshots._page_images(payload) == {}

    def test_drops_a_missing_page(self):
        payload = {"query": {"pages": [{"title": "Nobody", "missing": True}]}}
        assert headshots._page_images(payload) == {}

    # WHY: redirects are reported separately from pages, so without this the
    #      requested name would find nothing even though the article was
    #      fetched and did have an image.
    def test_maps_a_redirect_back_to_the_requested_title(self):
        payload = {
            "query": {
                "pages": [self._page("Duce Staley", "American football player",
                                     COMMONS_THUMB)],
                "redirects": [{"from": "Duce staley", "to": "Duce Staley"}],
            }
        }
        assert headshots._page_images(payload)["duce staley"].url == COMMONS_THUMB

    # WHY: an unanswered batch must not look like an answered-but-empty one.
    def test_handles_a_failed_request(self):
        assert headshots._page_images(None) == {}


class TestApplyWikipedia:
    NAMES = {"p1": "Eddie George", "p2": "Milton Wynn", "p3": "Kurt Warner"}

    # WHY: Wikipedia is the weakest source, so it must only ever fill gaps.
    #      Overwriting an nfl.com portrait with an article photo would swap a
    #      posed headshot for a candid twenty years after the fact.
    CREDIT = headshots.Credit(
        author="Jane Doe",
        license="CC BY-SA 4.0",
        license_url="https://creativecommons.org/licenses/by-sa/4.0",
        file_url="https://commons.wikimedia.org/wiki/File:Eddie_George.jpg",
    )

    def test_leaves_resolved_players_alone(self, monkeypatch):
        monkeypatch.setattr(
            headshots, "wikipedia_photos",
            lambda names: {"p1": headshots.Portrait(COMMONS_THUMB, self.CREDIT)},
        )
        resolved = [
            headshots.Resolved("p1", None, "NONE"),
            headshots.Resolved("p3", "https://nfl/w.png", "NFL"),
        ]
        out = {r.player_id: r for r in headshots.apply_wikipedia(resolved, self.NAMES)}
        assert out["p1"] == headshots.Resolved(
            "p1", COMMONS_THUMB, "WIKIPEDIA", self.CREDIT,
        )
        assert out["p3"] == headshots.Resolved("p3", "https://nfl/w.png", "NFL")

    # WHY: the credit has to travel with the picture, not beside it. A portrait
    #      written without one is a CC BY-SA image on a card with no
    #      attribution, which is the failure this change exists to close.
    def test_carries_the_credit_onto_the_row(self, monkeypatch):
        monkeypatch.setattr(
            headshots, "wikipedia_photos",
            lambda names: {"p1": headshots.Portrait(COMMONS_THUMB, self.CREDIT)},
        )
        out = headshots.apply_wikipedia(
            [headshots.Resolved("p1", None, "NONE")], self.NAMES,
        )
        assert out[0].credit.author == "Jane Doe"
        assert out[0].credit.license == "CC BY-SA 4.0"

    # WHY: a picture whose credit could not be fetched is still a free picture.
    #      Dropping it would cost a card its portrait over a lookup that the
    #      next run — or --credits — will complete.
    def test_keeps_a_portrait_whose_credit_is_unknown(self, monkeypatch):
        monkeypatch.setattr(
            headshots, "wikipedia_photos",
            lambda names: {"p1": headshots.Portrait(COMMONS_THUMB)},
        )
        out = headshots.apply_wikipedia(
            [headshots.Resolved("p1", None, "NONE")], self.NAMES,
        )
        assert out[0].url == COMMONS_THUMB
        assert out[0].credit == headshots.NO_CREDIT

    # WHY: a player Wikipedia cannot place stays NONE, which is what lets the
    #      card fall back to its team logo.
    def test_leaves_an_unfound_player_as_none(self, monkeypatch):
        monkeypatch.setattr(headshots, "wikipedia_photos", lambda names: {})
        out = headshots.apply_wikipedia(
            [headshots.Resolved("p2", None, "NONE")], self.NAMES,
        )
        assert out == [headshots.Resolved("p2", None, "NONE")]

    # WHY: no unresolved players means no reason to call Wikipedia at all.
    def test_skips_the_lookup_when_everything_resolved(self, monkeypatch):
        def explode(names):
            raise AssertionError("should not have asked Wikipedia")
        monkeypatch.setattr(headshots, "wikipedia_photos", explode)
        resolved = [headshots.Resolved("p1", "https://nfl/a.png", "NFL")]
        assert headshots.apply_wikipedia(resolved, self.NAMES) == resolved


class TestCleanThumbnailUrl:
    # WHY: the API appends a campaign query to every thumbnail. Storing it would
    #      have every card render fire an analytics beacon at Wikimedia, and the
    #      image is byte-identical without it.
    def test_strips_the_analytics_query(self):
        assert headshots._clean_thumbnail_url(
            "https://upload.wikimedia.org/wikipedia/commons/8/8a/Isaac_Bruce.jpg"
            "?utm_source=en.wikipedia.org&utm_campaign=api"
        ) == "https://upload.wikimedia.org/wikipedia/commons/8/8a/Isaac_Bruce.jpg"

    def test_leaves_a_clean_url_alone(self):
        url = "https://upload.wikimedia.org/wikipedia/commons/thumb/a/b/X.jpg/500px-X.jpg"
        assert headshots._clean_thumbnail_url(url) == url


class TestFileName:
    # WHY: this is what makes the backfill possible at all. Thousands of rows
    #      already hold a thumbnail URL and nothing else, and the file name is
    #      the only key Commons answers a licence question on. Recovering it
    #      from the URL is one request per fifty files instead of re-querying
    #      every article.
    def test_reads_the_original_out_of_a_thumbnail_url(self):
        assert headshots.file_name(COMMONS_THUMB) == "Eddie_George.jpg"

    # WHY: "500px-Eddie_George.jpg" is a rendering, not a file Commons has ever
    #      heard of. Taking the last path segment would ask about a file that
    #      does not exist and quietly return no credit for every portrait.
    def test_does_not_mistake_the_rendering_for_the_file(self):
        assert headshots.file_name(COMMONS_THUMB) != "500px-Eddie_George.jpg"

    # WHY: not every stored URL is a thumbnail — an image small enough already
    #      is served at its original path.
    def test_reads_a_full_size_url(self):
        assert headshots.file_name(
            "https://upload.wikimedia.org/wikipedia/commons/8/8a/Isaac_Bruce.jpg"
        ) == "Isaac_Bruce.jpg"

    # WHY: file names carry spaces, and a URL cannot. Leaving them encoded asks
    #      Commons about "Ed%20Reed.jpg", which is a different title.
    def test_decodes_a_percent_encoded_name(self):
        assert headshots.file_name(
            "https://upload.wikimedia.org/wikipedia/commons/1/1a/Ed%20Reed.jpg"
        ) == "Ed Reed.jpg"


class TestFileKey:
    # WHY: the two sides of the lookup spell the same file differently — the
    #      pageimages query answers with underscores, the imageinfo query
    #      echoes titles with spaces. Comparing them as they arrive silently
    #      loses every credit, with no error anywhere.
    def test_matches_underscores_against_spaces(self):
        assert headshots._file_key("Isaac_Bruce.jpg") == headshots._file_key(
            "Isaac Bruce.jpg"
        )

    def test_ignores_capitalisation(self):
        assert headshots._file_key("Isaac Bruce.JPG") == headshots._file_key(
            "isaac bruce.JPG"
        )


class TestPlainText:
    # WHY: Commons states the author as HTML — almost always a link to the
    #      uploader's user page. Storing it raw would put markup on a card.
    def test_strips_the_markup_commons_wraps_the_author_in(self):
        assert headshots._plain_text(
            '<a href="//commons.wikimedia.org/wiki/User:Foo" title="User:Foo">Foo</a>'
        ) == "Foo"

    # WHY: two links run together without a separator. "Jane DoeBob Roe" is not
    #      a credit anybody can act on.
    def test_keeps_two_elements_apart(self):
        assert headshots._plain_text(
            "<span>Jane Doe</span><span>Bob Roe</span>"
        ) == "Jane Doe Bob Roe"

    # WHY: the card renders text, so an entity has to arrive decoded or a name
    #      with an ampersand in it prints as "&amp;".
    def test_decodes_entities(self):
        assert headshots._plain_text("Smith &amp; Jones") == "Smith & Jones"

    # WHY: an uploader who left the field empty has given no author. Storing ""
    #      would print "Photo: , CC BY-SA 4.0" on a card.
    def test_returns_nothing_for_an_empty_field(self):
        assert headshots._plain_text("") is None
        assert headshots._plain_text(None) is None
        assert headshots._plain_text("<span> </span>") is None


class TestIsCommons:
    def test_accepts_a_commons_file(self):
        assert headshots._is_commons(COMMONS_THUMB)

    # WHY: **the licence guard.** /wikipedia/en/ is where English Wikipedia
    #      keeps its non-free uploads. Everything under /wikipedia/commons/ is
    #      free; nothing else is guaranteed to be.
    def test_rejects_a_locally_hosted_file(self):
        assert not headshots._is_commons(
            "https://upload.wikimedia.org/wikipedia/en/5/5a/Fair_use_logo.jpg"
        )

    # WHY: checked on the path, so a host merely containing the string cannot
    #      satisfy it.
    def test_rejects_a_lookalike_host(self):
        assert not headshots._is_commons("https://wikipedia.commons.example.com/x.jpg")

    def test_rejects_a_missing_url(self):
        assert not headshots._is_commons(None)
        assert not headshots._is_commons("")


class TestFileCredits:
    def _payload(self, **overrides):
        info = {
            "url": (
                "https://upload.wikimedia.org/wikipedia/commons/8/8a/Eddie_George.jpg"
            ),
            "descriptionurl": (
                "https://commons.wikimedia.org/wiki/File:Eddie_George.jpg"
            ),
            "extmetadata": {
                "Artist": {"value": '<a href="/wiki/User:Jane">Jane Doe</a>'},
                "LicenseShortName": {"value": "CC BY-SA 4.0"},
                "LicenseUrl": {
                    "value": "https://creativecommons.org/licenses/by-sa/4.0"
                },
            },
        }
        info.update(overrides)
        return {"query": {"pages": [
            {"title": "File:Eddie George.jpg", "imageinfo": [info]},
        ]}}

    def test_reads_the_whole_credit(self):
        assert headshots._file_credits(self._payload()) == {
            "eddie george.jpg": headshots.Credit(
                author="Jane Doe",
                license="CC BY-SA 4.0",
                license_url="https://creativecommons.org/licenses/by-sa/4.0",
                file_url="https://commons.wikimedia.org/wiki/File:Eddie_George.jpg",
            ),
        }

    # WHY: the description page is what CC BY-SA attribution points at — the
    #      author, the licence and the photograph are all stated there by the
    #      source. It is what the credit on the card links to.
    def test_keeps_the_description_page_not_the_file(self):
        credit = headshots._file_credits(self._payload())["eddie george.jpg"]
        assert credit.file_url.startswith("https://commons.wikimedia.org/wiki/File:")

    # WHY: the same guard as _page_images, read off the file record rather than
    #      off a rendering of it. A file that is not on Commons must contribute
    #      no credit, because its picture must not reach a card.
    def test_drops_a_file_that_is_not_on_commons(self):
        payload = self._payload(
            url="https://upload.wikimedia.org/wikipedia/en/5/5a/Fair_use.jpg",
        )
        assert headshots._file_credits(payload) == {}

    # WHY: Commons files are old and inconsistently filled in. A public-domain
    #      scan with no stated author is still usable; failing on it would cost
    #      the card a picture over a field nobody was required to fill.
    def test_tolerates_a_missing_field(self):
        payload = self._payload(extmetadata={"LicenseShortName": {"value": "Public domain"}})
        credit = headshots._file_credits(payload)["eddie george.jpg"]
        assert credit.author is None
        assert credit.license == "Public domain"

    # WHY: keyed the way the caller looks it up — see TestFileKey.
    def test_keys_on_the_normalised_file_name(self):
        assert headshots._file_key("Eddie_George.jpg") in headshots._file_credits(
            self._payload()
        )

    # WHY: an unanswered batch must leave the portraits uncredited rather than
    #      raise, so the run still writes the pictures it found.
    def test_handles_a_failed_request(self):
        assert headshots._file_credits(None) == {}

    def test_handles_a_page_with_no_imageinfo(self):
        payload = {"query": {"pages": [{"title": "File:Gone.jpg", "missing": True}]}}
        assert headshots._file_credits(payload) == {}


class TestWikipediaPhotos:
    def _article_payload(self, title, thumb, name):
        return {"query": {"pages": [{
            "title": title,
            "description": "American football player",
            "thumbnail": {"source": thumb},
            "pageimage": name,
        }]}}

    # WHY: the end-to-end shape of the lookup — an article yields a picture and
    #      the file behind it yields the credit, joined on the file name. Each
    #      half is covered above; this pins that they meet.
    def test_joins_the_credit_onto_the_portrait(self, monkeypatch):
        credit = headshots.Credit("Jane Doe", "CC BY-SA 4.0", None, None)
        monkeypatch.setattr(
            headshots, "_wikipedia_query",
            lambda titles: self._article_payload(
                "Eddie George", COMMONS_THUMB, "Eddie_George.jpg",
            ),
        )
        monkeypatch.setattr(
            headshots, "credits_for", lambda files: {"eddie george.jpg": credit},
        )
        monkeypatch.setattr(headshots.time, "sleep", lambda _: None)

        assert headshots.wikipedia_photos({"p1": "Eddie George"}) == {
            "p1": headshots.Portrait(COMMONS_THUMB, credit),
        }

    # WHY: the file lookup is asked once per distinct file, after both title
    #      forms have run — not once per batch per form. Two brothers sharing a
    #      team photo must not be two requests.
    def test_asks_about_each_file_once(self, monkeypatch):
        asked = []
        monkeypatch.setattr(
            headshots, "_wikipedia_query",
            lambda titles: self._article_payload(
                titles[0], COMMONS_THUMB, "Eddie_George.jpg",
            ),
        )
        monkeypatch.setattr(headshots, "credits_for", lambda files: asked.append(files) or {})
        monkeypatch.setattr(headshots.time, "sleep", lambda _: None)

        headshots.wikipedia_photos({"p1": "Eddie George"})
        assert len(asked) == 1


class TestPurgeNonFree:
    """The guard against portraits the league has no licence for.

    Not a hypothetical: run against the real table this found 7 stored
    portraits out of 256 that were English Wikipedia's own non-free uploads,
    which `pilicense=free` had passed. Those cards were showing fair-use
    pictures, so the reset below is a correction and not a precaution.
    """

    EN_WIKI = "https://upload.wikimedia.org/wikipedia/en/0/06/Jerry_Porter.jpg"

    def _rows(self, monkeypatch, rows):
        """Points the reader at canned rows and captures what gets written."""
        written = []
        monkeypatch.setattr(headshots, "stored_wikipedia_rows", lambda: rows)
        monkeypatch.setattr(
            headshots.turso, "execute_chunked",
            lambda sql, args, **kw: written.append((sql, list(args))) or len(list(args)),
        )
        return written

    # WHY: the whole point. A fair-use upload that is already stored keeps
    #      serving its picture until something clears it — the source-side
    #      filter only stops new ones.
    def test_resets_a_portrait_that_is_not_on_commons(self, monkeypatch):
        written = self._rows(monkeypatch, [{"playerId": "p1", "url": self.EN_WIKI}])

        assert headshots.purge_non_free() == 1
        sql, args = written[0]
        assert args == [("p1",)]
        # Cleared to NONE rather than deleted: the card falls back to its team
        # logo, and an ordinary run re-checks a NONE row later.
        assert "'NONE'" in sql
        assert '"url" = NULL' in sql

    # WHY: the credit columns describe the picture. Leaving them behind on a
    #      cleared row would attribute a photograph the card no longer shows.
    def test_clears_the_credit_along_with_the_picture(self, monkeypatch):
        written = self._rows(monkeypatch, [{"playerId": "p1", "url": self.EN_WIKI}])
        headshots.purge_non_free()

        sql = written[0][0]
        for column in ("author", "license", "licenseUrl", "fileUrl"):
            assert f'"{column}" = NULL' in sql

    # WHY: a Commons portrait is exactly what the game is allowed to show.
    #      Clearing one would cost a card its picture for no reason.
    def test_leaves_a_commons_portrait_alone(self, monkeypatch):
        written = self._rows(monkeypatch, [{"playerId": "p1", "url": COMMONS_THUMB}])

        assert headshots.purge_non_free() == 0
        assert written == []

    def test_writes_nothing_when_every_portrait_is_free(self, monkeypatch):
        written = self._rows(monkeypatch, [])
        assert headshots.purge_non_free() == 0
        assert written == []

    # WHY: the mixed case is the real one — 7 bad rows among 249 good ones.
    #      Only the offenders may be touched.
    def test_resets_only_the_offenders(self, monkeypatch):
        written = self._rows(monkeypatch, [
            {"playerId": "good1", "url": COMMONS_THUMB},
            {"playerId": "bad",   "url": self.EN_WIKI},
            {"playerId": "good2", "url": COMMONS_THUMB},
        ])

        assert headshots.purge_non_free() == 1
        assert written[0][1] == [("bad",)]
