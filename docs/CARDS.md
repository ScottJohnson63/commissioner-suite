# Draft Deck — Reference

A season-long card game at `/league/cards`, layered over the NFL stats the app
already syncs. Every (season, player) pair is a collectible card; members earn a
weekly pack allowance, open packs, and build a deck that is wiped when the game
season rolls over.

**Cards are owned exclusively.** One card has exactly one owner for the whole
season — if you pull the 2025 Christian McCaffrey, nobody else in the league can
ever have him. Nobody is trying to collect the full set; everyone is racing for
the scarce top of it, and the season is won by whoever ends up with the rarest
deck. That single rule is what most of the design below follows from.

---

## Cards

One card per player per season. A card is the player's whole regular season
condensed to a points total, a position finish, and a tier.

| Detail | Value |
|--------|-------|
| Eligible positions | QB, RB, WR, TE |
| Season window | Regular season only (`seasonType = 'REG'`) |
| Source table | `NflWeeklyStat`, summed per player per season |
| Image | `NflPlayerHeadshot`, resolved by `sync_player_headshots.py` — nfl.com where it holds a real photograph, then ESPN, then Wikimedia Commons, null where nobody does |
| Jersey number | `NflSeasonRoster`, synced by `sync_nfl_rosters.py` |
| Current pool | **13,491 cards** across 1999–2025 |

**Kickers and team defenses are not cards.** nflverse scores neither — its
fantasy columns cover offence only, and it publishes individual defenders rather
than a team-defense row — so both had to be scored by hand from the box score.
Both hand-rolled formulas then turned out to rest on columns the feed leaves
empty: fumble recoveries, safeties, blocked kicks and special-teams touchdowns
are **zero league-wide in every season**, as are the field-goal distance
buckets. That left kickers ranked on flat make counts and the entire league of
defenses spanning about four points a game — DEF1 and DEF32 interchangeable.
Neither made a card worth chasing, so neither is a card.

Points allowed, the largest component of real DST scoring, *is* obtainable from
`load_schedules()` if defenses are ever worth revisiting.

### What the card face shows

The headline number is **PPR points per game**, with the jersey number worn that
season in the opposite corner.

nflverse has no per-game fantasy column. Its season summary
(`summary_level='reg'`) does carry a `games` count, and that count is exactly
the number of weekly rows a player has in `NflWeeklyStat` — verified equal for
all 2,019 players of 2025 — so games are counted from rows already stored and
need no extra sync. `pointsPerGame` is computed and stored at pool-build time
rather than divided on read, so the card, the API and any future sort agree, and
a zero-game row cannot surface as `NaN`.

Jersey numbers are a different matter: they are on nflverse's **roster** feed,
not the player-stat feed, so they need `NflSeasonRoster` and its own sync.
Coverage is 100% of cards. A player whose roster row is missing leaves the slot
empty rather than showing a placeholder.

The headline number is also what the tier is ranked on, so a card can never show
a higher average than one a tier above it. That was not true of an earlier
build, which tiered on season totals and produced 403 such inversions inside the
top 20 — verified back to zero after the change.

### Tiers

Tiers are assigned **within each position**, by **PPR points per game**, among
players with at least **9 games**. The top five quarterbacks of a season are
Hall of Fame, and so are the top five tight ends.

| Tier | Position finish | Count (1999–2025) | Share of pool |
|------|-----------------|-------------------|---------------|
| Hall of Fame | 1–5 | 540 | 4.0% |
| Gold | 6–10 | 540 | 4.0% |
| Silver | 11–30 | 2,160 | 16.0% |
| Bronze | 31+ | 10,251 | 76.0% |

The first three are fixed by arithmetic: 5 + 5 + 20 ranks per position, four
positions, 27 seasons. Bronze is whatever is left over.

**Silver runs to rank 30.** It used to stop at 20, which left the three named
tiers covering 30 ranks per position and Bronze absorbing everything below —
84% of the pool. Since the pack recipe can only deal what the pool holds, that
band is the deepest cause of "too much Bronze", underneath any drop weight.
Twenty ranks of Silver takes Bronze to 76% and, just as importantly, gives the
Silver drop rate enough supply to be sustainable — see "What this costs the
pool". A Silver card is now the 30th-best receiver of a season rather than the
20th, which is still a starter in a twelve-team league.

⚠️ Tiers are assigned at build time by `rebuildCardPool`, not derived on read,
so **changing any of these requires a pool rebuild** before it takes effect.

Three decisions behind that:

**Per position.** On one combined leaderboard no tight end would ever clear a
top-five cut against a running back, so the position would be permanently Bronze
and there would be nothing to chase in it.

**Per game, not season total.** A card is a claim about how good a player was,
not how long he stayed fit — and since the card face prints the average, ranking
on the total put Gold cards above Hall of Fame ones on their own headline
number. Ranking on the same figure the card shows means the frame and the number
can never disagree.

**A 9-game floor.** Half a season: enough that an average means something, low
enough that a genuinely elite player who missed six weeks still competes for the
top tier. Patrick Mahomes is QB4 of 2025 on 14 games and George Kittle is TE3 on
11 — both would have been buried by a season-total ranking.

Players below the floor keep their cards — they played, so they are collectible
— but are ranked beneath everyone who cleared it, which in practice makes them
Bronze. A three-game hot streak cannot outrank a season.

### Scoring

Three scoring paths, because nflverse only populates its fantasy columns for
offensive production.

One path, because nflverse scores exactly the four positions that get cards:
`fantasyPointsPpr`, summed over the regular season, then divided by games played
to give the per-game figure the tier is set from.

---

## Packs

Every pack holds **5 cards**. The pack's own tier is rolled first, then filled.

| Pack | Guarantees | Rest of the pack |
|------|-----------|------------------|
| Hall of Fame | 1 Hall of Fame | 4 from Gold / Silver / Bronze |
| Gold | 2 Gold | 3 from Silver / Bronze |
| Silver | 3 Silver | 2 Bronze |
| Bronze | 5 Bronze | — |

Filler is drawn from strictly lower tiers, weighted Gold 10 : Silver 40 :
Bronze 48 and renormalized over whichever tiers are on offer. A pack never
contains a card rarer than its own tier.

`FILLER_TIER_WEIGHT` has a Hall of Fame entry and it is never read: filler draws
from `lowerTiers`, nothing sits above Hall of Fame, so it is never a candidate
in any pack. The key exists only because the Record is total over `CardTier`.

Pack type is rolled at **Hall of Fame 8 : Gold 16 : Silver 36 : Bronze 40**.
Tiers with no cards in the pool are excluded from the roll rather than rolled
and substituted.

All of these numbers live in `src/lib/cards/tiers.ts`.

### What a member actually ends up with

The three tables above are tuned separately and none of them shows the result,
which is how the ladder came to be inverted once already. This is what they add
up to, per 5-card pack:

| Tier | Share of cards dealt | Per member per season (39 packs) |
|------|----------------------|----------------------------------|
| Hall of Fame | 1.6% | 3.1 |
| Gold | 7.1% | 13.8 |
| Silver | 28.6% | 55.7 |
| Bronze | 62.8% | 122.4 |

`tiers.test.ts` pins the invariant rather than the numbers: **each tier must be
dealt more often than the tier above it**, and Bronze must stay under two thirds
of everything dealt. Change any of the three tables and that test is what tells
you whether the ladder still holds.

**Hall of Fame is meant to be reachable.** Its drop weight was 3, which left a
member opening a season's 39 packs missing the tier entirely 20% of the time —
one member in five finished the year with the top tier as something only other
people had. At 8 that miss rate is 4%. It is still the rarest pack by a factor
of two, and it costs the pool almost nothing: a twelve-member season draws about
7% of the 540 Hall of Fame cards, which were otherwise sitting unclaimed.

Note that raising the *drop weight* is the only lever that makes the top tier
feel reachable. Raising `PACK_GUARANTEE.HALL_OF_FAME` would make each Hall of
Fame pack bigger without making the moment any commoner — it changes what the
pack is, not how often you get one.

### How the Gold guarantees are delivered

Both quotas are pity timers rather than pre-drawn packs. Pre-drawing would fix a
whole supply the first time someone loaded the page; this way every pack is
genuinely rolled when it is opened, and a member who rolls their own Golds never
notices the guarantee is there.

The rule: **force this pack to Gold if, even were every remaining pack in the
same supply to come up Gold, the member still could not reach that supply's
quota.** For the starter grant that leaves the first three genuinely random and
forces the last two only if nothing has landed.

A Hall of Fame pack satisfies a quota — it is strictly better and carries Gold
cards as filler, so forcing a Gold afterwards would be a downgrade dressed up as
a guarantee.

---

## Weekly allowance

There are three supplies, and they are counted separately because each carries
its own promise.

| Supply | Packs | Guaranteed Gold or better | When |
|--------|-------|---------------------------|------|
| Starter | 5 | **2** | Once, the first time a member opens the game |
| Ration | 2 | **none** | Every week **from week 2** |
| Sleeper bonus | 1 ordinary pack | — | Per rule earned, see below |
| Contributed portrait | 1 per card, **15 a season** | — | On giving a faceless card a face, see **Customization** |

These stack. A member's season is 5 starters plus 34 ration packs, times about
1.46 for the wildcards those pull, plus whatever Sleeper pays and up to 15
more for contributing portraits to cards that had none.

Packs are opened **starter first, then bonus, then ration** — starters are the
onboarding and should not sit behind ordinary packs, and neither should a pack
won from a Sleeper result.

**Week 1 pays no ration.** A member's first week is the starter grant and
nothing else, so the game opens with one clean handful of five rather than ten
packs at once, and the weekly rhythm starts the following Tuesday. The rule is
one function, `packsForWeek`, and it is keyed on the NFL week rather than on how
long the member has been playing: somebody who first opens the game in week 6
gets week 6's ration straight away.

⚠️ **The Gold quotas never subsidise each other.** Only the starter grant
carries a quota now, but the filter still matters: a Sleeper bonus must not
count towards it, or a member who won a bonus in their first week would get
fewer guaranteed Gold starter packs than one who did not. `PackOpening.kind`
exists to make that filter possible.

### The starter grant

Five packs the first time a member opens the game, two guaranteed Gold or
better — enough to field a lineup with rather than a pile of Bronze.

Granted on first read rather than at sign-up: there is no hook on account
creation, and "the first time they open the game" is the moment that matters.
The `upsert` keyed on `(userId, gameSeason)` is what makes it once — two tabs
loading together cannot both grant it.

Scoped to the game season rather than the account, so the end-of-season reset
hands out a fresh set along with the cleared decks: a member coming back to an
empty deck needs the same leg up as a new one.

### The weekly ration

**Two packs a week, from week 2 onward.**

The number is small on purpose. Ownership is exclusive, so every pack opened is
cards taken permanently out of everyone else's reach — the ration is the dial
that decides how long the pool lasts, and the arithmetic below is what it costs.
Wildcards and Sleeper bonuses are what make a good week big; the ration only has
to make every week worth showing up for.

**The ration carries no Gold guarantee**, and that zero is load-bearing.

It used to be one a week. The pity timer forces a pack whenever the supply can
no longer reach its quota, so with two packs and a quota of one the first pack
was a free roll and the second was forced unless the first had already landed
Gold or better — which it did 15% of the time. **85% of second ration packs were
forced to Gold.** Roughly half of every pack in the game became a Gold pack, and
Gold cards ended up commoner than Silver ones: 19% of everything dealt against
15%. Silver is the tier below Gold and it was arriving less often than the tier
above it.

The guarantee was sound at the old five-pack ration, where it was a 20% floor.
At two packs it is a 50% floor, which is not a floor but a redesign. The ration
is small enough now that a member notices every pack, so all of them roll and
the Silver band was widened instead — see the drop weights above.

The starter grant keeps its quota of two in five. That is still a minority of
its supply, and a new member's first handful is the one place a guarantee earns
its distortion.

The tier of the next pack is decided in advance and stored on the grant, so the
sealed wrapper is printed in that tier's colours and names it before you tear it
open. It has to be persisted: a tier rolled at render time would change on every
reload, and a member would refresh until a Hall of Fame pack appeared. It is
rolled once, and replaced only when the pack it describes is actually opened.
The starter grant's Gold quota applies to the pre-roll too, otherwise a pack
could be shown as Bronze and then silently overridden on open.

Grants are created lazily on first visit each week and are never back-filled: a
member who skips three weeks gets this week's packs, not a backlog.

### Wildcards

**A card you pull, worth one to six extra packs.**

Wildcards fall out of Silver, Gold and Hall of Fame packs at
`WILDCARD_PULL_CHANCE` (0.15), so the packs worth opening are the ones that can
pay out again. A wildcard takes a card slot rather than adding a sixth: it
displaces the pack's weakest card, never the guaranteed rare one it was opened
for. A five-card pack that finds one deals four players and a die.

This used to be a weekly entitlement — one nullable column on the grant, one
throw a week, available whether or not you had opened anything, which made it a
login bonus rather than part of the game.

Each wildcard is its own `WildcardCard` row, so a member can be holding several
and throws each separately. The update that writes the result has
`rolledValue: null` and the member's own `userId` in its `where` clause, so a
double-click, a retried request, or somebody else's id all match nothing and
change nothing. The packs land on the *current* week's grant rather than the
week the wildcard was found — packs a member can no longer reach are not a
prize.

The die is rolled server-side. A die thrown in the browser is one you can throw
until you like the answer.

The opener offers the die at the moment the wildcard is turned over, and the
Packs tab lists any that were pulled and never thrown, so closing the tab
mid-reveal cannot strand one.

### Sleeper bonus packs

Two rules, each worth one extra pack a week, driven by what the member actually
did in Sleeper:

| Rule | Earned by |
|------|-----------|
| `WIN` | Winning a matchup in any of their Sleeper leagues |
| `HIGH_SCORE` | Scoring over **100** in any of their Sleeper leagues |

**"Any" is doing real work.** A member in four leagues who wins all four gets
*one* win pack, not four. That is enforced by the unique key on
`(userId, gameSeason, week, kind)` in `PackBonus` rather than by counting in
application code, so two page loads racing cannot both award it.

**A bonus pack is an ordinary pack** — five cards, rolled on `PACK_DROP_WEIGHT`
like every other, Bronze included. The reward is the extra pack, not a better
one.

It used to be ten cards with a Silver floor, and that made it by far the most
expensive thing in the game:

| | Silver drawn per pack |
|---|---|
| Ordinary 5-card pack | 1.43 |
| Old floored 10-card bonus pack | **3.26** |

Two of those a week out-drew the entire weekly ration, and Silver is the tier
that empties first. It put a twelve-member league past a 70% Silver drain before
any other reward existed, and it was what forced the customization cap down to
6. Normalising it is what paid for that cap being 15.

Three pieces of machinery existed only to keep it special and are gone with it:
`BONUS_PACK_CARDS`, `BONUS_PACK_TIERS` and `rollBonusPackTier`, along with
`openPack`'s `size` parameter — a knob with one setting is worse than no knob.
Granting a bonus no longer clears the pre-rolled `nextPackTier` either: that
existed because a tier rolled before the bonus could be Bronze and a floored
pack could not accept it. Any stored tier is valid now, and discarding it would
take away the wrapper the member was looking at.

Bonus packs are still spent before ration packs, since holding one behind the
week's ration would bury it.

#### Cost against Sleeper

Sleeper is pull-only, so the check runs when a member opens the card page. Three
things keep that cheap:

- Once both bonuses exist for the week there is nothing left to win, and the
  check returns without touching the network at all.
- A two-minute in-process guard stops a re-rendering page from re-asking.
- The per-league loop stops as soon as both rules are satisfied, so a member in
  six leagues usually costs two leagues' worth of calls.

Everything underneath goes through `sleeperGet`, so the Next fetch cache
collapses bursts on top of all of that. A Sleeper outage means no bonus this
minute, not a broken card page — `detectBonuses` never throws.

### What this costs the pool

This is the number that matters most, and it is a direct consequence of
exclusive ownership.

```
 5 starter + (2 × 17 ration weeks)          =  39 packs
 wildcards: 60% of packs are Silver-or-up, each pulls a die at 0.15,
            and a die averages 3.5 packs    → ×1.46
                                            ≈  57 packs
 57 packs × 5 cards                         ≈ 285 cards per member per season
```

The pool now holds **13,491 cards** across 1999–2025, which supports a
twelve-team league comfortably. What matters is not the total but the per-tier
drain, since the tiers are consumed at very different rates:

| Tier | Pool | Consumed by a 12-member season |
|------|------|-------------------------------|
| Hall of Fame | 540 | 10% |
| Gold | 540 | 45% |
| Silver | 2,160 | 45% |
| Bronze | 10,251 | 21% |

**Silver is the binding constraint**, and widening its band to rank 30 is what
keeps it safe. At the old ten-rank band the same pack weights consumed about
**90%** of the Silver pool in one season — and a tier that runs dry is excluded
from `rollPackTier` entirely, which would have collapsed the game back to Bronze
around week 15. Doubling the supply takes that to 45%.

Two effects compound here, which is why it was tighter than it looked. Silver is
dealt more often *and* Silver-or-better packs are what carry wildcards, so
raising the Silver drop rate from 25 to 36 also took the wildcard multiplier
from ×1.27 to ×1.46 — more packs opened overall, each likelier to want Silver.

Hall of Fame has by far the most unused headroom: 540 cards and a 10% season
drain. The top tier is nowhere near scarce in supply, only in how often it is
dealt — which is why its drop weight, not its band, was the lever for making it
reachable.

Any further increase to a Silver weight should be checked against this table
first; it is the tier that runs out.

Sleeper bonuses sit on top and are not in the figure: a member who earns both
rules every week adds 34 ordinary packs, which roughly doubles their season.
That is why the customization cap is sized against a bonus win rate rather than
against the ration alone — see **Customization**.

The pool draining is a real end state, not a cosmetic worry: when no unclaimed
cards remain, packs cannot be dealt at all. The game page warns once the pool
drops below 15% unclaimed, and `/api/cards/open` answers 409 when it is empty.

---

## The lineup

A member's **deck** is everything they own. Their **roster** is the nine cards
they field, and it is the roster that decides the standings.

| | Slot | Accepts |
|---|------|---------|
| 1 | QB | QB |
| 2–3 | RB | RB |
| 4–5 | WR | WR |
| 6 | TE | TE |
| 7–9 | FLEX | RB, WR, TE |

Nine slots, a third of them FLEX. The kicker and defense slots that used to sit
at the end went when those positions stopped being cards; a third FLEX took
their place rather than shrinking the lineup to seven, which keeps a roster a
real set of choices instead of a formality.

The split is the point. Owning a second elite running back is worth nothing once
a better one holds the slot, so the game is about which nine you field rather
than how many you hoard — which is what turns a pile of cards into a set of
decisions.

Slots live one row each in `RosterSlot`, keyed by the ids in
`src/lib/cards/roster.ts`, so reshaping the lineup means editing that array and
nothing else. Two unique keys do two jobs: one slot holds one card, and one card
sits in at most one slot — the second is what stops the same running back
starting at RB1 and FLEX1 at once. Assigning a card that is already starting
elsewhere **moves** it rather than failing.

Eligibility is enforced server-side in `setRosterSlot`. The picker filters by
the same `slotAccepts` rule, but a filtered picker is a convenience, not a guard.

## Winning

Two numbers, answering two different questions.

**Lineup PPG** — the combined points per game of the nine starters. This is what
the standings rank on. A sum rather than an average, because that is what a
lineup means: the points you would put up in a week if everyone played to their
season average. Empty slots contribute nothing, so a half-filled lineup scores
half as much.

**Deck average PPG** — the mean points per game across every card owned. It
answers the other question: not "how good is your best ten" but "how good is
everything you pulled". A member hoarding good cards they cannot start still has
a number that reflects it. It also breaks ties in the standings.

The rank card on `/league/cards` shows a member's position, both numbers, and
the gap to whoever is above them — `3rd of 8` is a fact, `3rd, 4.2 PPG off 2nd`
is a reason to go and fill a slot. Its frame borrows the tier palettes: first
place is drawn in Hall of Fame, descending from there, so climbing the table
changes the metal of your own card.

The standings list every account, including members who have not opened
anything, on zero.

---

## Season reset

Everything a member owns is scoped to `gameSeason`, which tracks `NFL_SEASON`.
A commissioner clears a season from the panel at the bottom of `/league/cards`,
which requires typing the year back before the button enables.

The reset clears decks, grants and openings — which also releases every claimed
card back into the pool for the new season. It leaves the card pool itself
alone: cards are derived from NFL history and do not expire.

For development, where there is no session to authenticate with,
`npx tsx prisma/reset-card-game.ts [season]` does the same thing from the
command line. Omit the season to clear every one.

---

## Data depth, and how to go deeper

The pool spans whatever seasons `NflWeeklyStat` holds, which today is
**2023–2025**. That is not a limit of the card game or of nflverse — nflverse
publishes player stats from 1999 with the same 150 columns. It is a limit of
what has been synced. Portraits are the one thing that genuinely thins out with
age — see **Portraits** below.

Three jobs decide the depth:

| Job | Effect |
|-----|--------|
| `python/scripts/backfill_nfl_seasons.py 1999 2022` | One-off. Upserts whole seasons; never truncates, so it is restartable and idempotent. |
| `python/scripts/sync_nfl_rosters.py` | Jersey numbers. Follows whatever seasons `NflWeeklyStat` holds, so run it after a backfill. |
| `python/scripts/sync_player_headshots.py` | Portraits. Checks every card-pool player against nfl.com, ESPN and Wikipedia, and records a picture or the absence of one. Run after a backfill, before rebuilding the pool. |
| `python/scripts/load_completed_season.py` | Runs August 1. **Appends** the season that just finished. Deletes nothing. |

**These no longer fight each other.** The August job used to truncate the table
and reload a rolling three-season window, which meant a four-hour backfill was
destroyed by the next run. It now adds the finished season and deletes nothing,
so the table only ever grows and history stays put. `NFL_SEASONS_TO_LOAD` is
gone along with the behaviour it configured.

`nflstats.truncate()` still exists as a manual maintenance tool, but nothing
scheduled calls it. Calling it loses every season not in whatever you load
next.

#### Running the sync scripts locally

The Python scripts were written for GitHub Actions, where credentials arrive as
injected secrets. Run one by hand and nothing has ever put them in the
environment. `common/localenv.py` now reads `nextjs/.env` and
`nextjs/.env.local` on import — existing environment variables always win, so it
is a no-op in CI — and each write script calls `localenv.require()` before doing
any work, so a missing credential costs a second rather than a season of
downloaded stats followed by a `KeyError`.

Three things about the Turso HTTP client are worth knowing before adding another
sync, because each one was found the hard way by a backfill dying partway:

- **Integers are encoded as strings.** Turso's Hrana JSON protocol does that so
  a JSON parser using double-precision numbers cannot silently round a 64-bit
  value. Sending a bare number is rejected with *"invalid type: integer,
  expected a borrowed string"*.
- **`NaN` and `Infinity` are sent as `NULL`.** JSON has no representation for
  them — `json.dumps` writes a bare `NaN` and Turso answers with a parse error
  pointing at a character offset deep in a 100 KB body. `NULL` is also what they
  mean: nflverse produces them for ratios like `wopr` and `airYardsShare` in
  seasons before air yards were tracked, where the denominator is zero. 1999
  alone has thousands.
- **Requests retry with backoff, except on 4xx.** A 1999–2022 backfill is
  roughly four thousand requests, so a transient timeout is a certainty rather
  than an exception; the read timeout is 120s and transient failures get four
  attempts. A 4xx is not retried — the same bytes get the same answer, and the
  response body is the part that says what was wrong.

**The backfill runs at about 1,700 rows a minute — roughly ten minutes a season
— and that is the floor.** Three ways of speeding it up were measured and all
three are dead ends:

| Idea | Result |
|------|--------|
| Bigger chunks | 100 rows is already ~800 KB, near Turso's request ceiling. 250 rows is over 2 MB and rejected. |
| Concurrent chunks | **Slower.** Six at once managed 1,393 rows/min against 1,666 sequential. The constraint is upload throughput (~143 MB in 757 s, ~1.5 Mbps), not latency — parallel requests divide the same pipe. |
| Compressing the body | Would be the real fix: the payload is mostly numbers and nulls and gzips **48×**, 825 KB → 17 KB. Turso answers a gzipped body with a 400. |

So the only saving that works is **not uploading a season twice**. The backfill
downloads each season (seconds) and compares nflverse's row count to what is
stored; a match skips the upload entirely. Re-running `1999 2022` after an
interrupted run walks past everything already in and picks up where it stopped.
A partial season does not match, so a half-loaded season is re-uploaded rather
than leaving a hole. `--force` uploads regardless, which is what you want after
nflverse publishes corrections.

Rough scale of a full 1999+ backfill: ~17,000 rows a season × 28 seasons ≈
480,000 rows, and a card pool around 16,000 — enough to sustain a league of
sixty-odd at the current ration. Portrait coverage does thin with age
— see **Portraits** — so run `sync_player_headshots.py` after any backfill and
before rebuilding the pool.

After any change to the stat table — or to the tier bands in `TIER_MAX_RANK` —
a commissioner must **rebuild the card pool** for it to reach the game. Tiers
and portraits are both resolved at build time, not on read.

Two ways to run it:

```bash
npx tsx prisma/rebuild-pool.ts
```

from `nextjs/`, or the rebuild button on `/league/cards` under Commissioner.
Both call the same `rebuildCardPool`. The CLI form prints the tier counts before
and after and checks for orphaned ownerships, which is worth having when the
rebuild follows a band change rather than a routine stat sync.

The rebuild is destructive to `CardDefinition` and safe for collections: rows
are dropped and rewritten, but ids are reused per `(season, playerId)`, so
member decks survive intact.

---

## Customization

A member can give a card they own a **nickname** and a **picture**. Neither
touches the pool — `CardDefinition` is rebuilt wholesale from the stat table and
would drop anything written onto it.

The nickname replaces the player's name on the card face; the real name stays on
the detail panel, so a renamed card is still identifiable. It is free, earns
nothing, and resets with the ownership it sits on.

### Two kinds of upload

An upload is one of two different things, and which one depends entirely on
whether the card already had a face.

| | Contributed portrait | Vanity override |
|---|---|---|
| When | Card has no photograph anywhere | Card already has one |
| Earns | **1 pack** | nothing |
| Table | `CardPortrait` | `CardImage` |
| Season reset | **survives** | cleared |
| Belongs to | the card | this season's owner |

About 1,900 cards show a team logo because no photograph of that player exists —
nfl.com serves the generic silhouette, ESPN 404s them, Wikipedia has no article
image. See **Portraits**. Giving one of those a face is a contribution to the
pool rather than decoration: it is the only face that card will ever have, so it
outlives the member's ownership and next season's owner inherits it.

Putting your dog on Patrick Mahomes is the other thing. It earns nothing and is
gone at the reset.

⚠️ **`CardPortrait` is deliberately absent from `OWNED_TABLES`, in both the
route and `prisma/reset-card-game.ts`.** It has no `gameSeason` column at all,
which makes adding it impossible rather than merely wrong — the reset's `where`
could not scope to it. `tests/app/api/cards/route.test.ts` pins this by giving
the Prisma mock no `cardPortrait`: listing it makes the reset throw rather than
quietly destroying every contribution the league has made.

Precedence on screen is override → contributed portrait → pool headshot → team
logo. The override wins because it is this season's owner's active choice.

### The upload route

`POST /api/cards/image` takes both fields. One route rather than two because the
reward decision depends on the upload, and splitting them would mean either
duplicating that decision or racing it.

Two body shapes. `multipart/form-data` carries a file and an optional nickname;
`application/json` handles nickname-only edits and clearing. In both, an absent
field is left alone and `null` clears it — that distinction is what lets one
route serve both without either wiping the other's work. Clearing removes only
the override; a contributed portrait is not the uploader's to withdraw.

⚠️ **JSON can clear a picture but never set one.** An image must arrive as a
file and is encoded server-side. A client-supplied data URI is an arbitrary
string that would reach a card face unchecked, and `image/svg+xml` is a script
host — so the type is taken from the upload and checked against a JPEG/PNG/WebP
allowlist before being stored and later replayed as the response Content-Type.
The size cap is 256 KB, enforced on the declared `content-length` before
buffering and again on the bytes actually read.

There is no object storage, so images are stored inline as base64. `GET
/api/cards/image?cardId=…` serves them, and the collection response carries a
URL rather than the bytes: inlined, a member with forty customized cards would
put ten megabytes on the wire on every page load. The URL carries the upload
time so a replaced picture busts the long immutable cache. The browser
downscales to a 640px longest edge and re-encodes as JPEG before sending.

### What it earns

**One pack per faceless card given a face, capped at 15 a season.** The
`cardId` uniqueness on `CardPortrait` is what makes it once ever: the insert
either wins or it does not, so two tabs uploading the same card cannot both be
paid. Past the cap an upload still works — it just lands as an override and
earns nothing, which is the honest degradation.

That cap is a pool-safety limit, not a game-feel one. Silver drained over a
season by a **ten-member** league, counting every supply — ration, starter,
wildcards and Sleeper bonuses:

| Cap | No bonuses | 25% won | 50% won | 75% won |
|-----|-----------|---------|---------|---------|
| 0 | 38% | 46% | 54% | 62% |
| **15** | 52% | 60% | **69%** | 77% |
| 20 | 57% | 65% | 73% | 82% |

50% is the realistic planning figure — a member wins about half their matchups
by definition, and 100 PPR points is a low bar. Fifteen is the largest round
number that holds a 70% Silver ceiling there.

This was briefly 6, sized when the Sleeper bonus was still a ten-card pack with
a Silver floor: that one pack ate most of the budget on its own. Normalising it
is what paid for the cap being this size.

⚠️ **Sized for ten members.** At twelve the same cap puts Silver at 82%, past
the ceiling. A growing league should drop this to about 4, or widen
`TIER_MAX_RANK.SILVER` again to add supply.

---

## Portraits

`NflWeeklyStat.headshot` is nflverse's `headshot_url`, an nfl.com Cloudinary
link, and it is not a reliable answer to "is there a picture of this player".
About half of those links answer **HTTP 200 with the league's generic
faceless-helmet silhouette** rather than a photograph. Two things followed from
trusting it, and both were invisible from the database:

* Coverage measured as "the column is not null" looked complete back to 1999.
  Measured by eye, 6,865 of 13,491 cards — **50.9%** — were the black helmet.
* Because the silhouette is a 200 and not a 404, `PlayerCard`'s `onError` never
  fired, so those cards could not fall through to a team logo either.

`sync_player_headshots.py` resolves it properly into `NflPlayerHeadshot`, one
row per player:

1. **Fingerprint nfl.com.** The silhouette is one image published under ~1,800
   distinct Cloudinary public ids, so there is no id to blocklist and its
   full-size encoding varies. Requesting it through a fixed
   `w_32,h_32,c_fill,f_png,q_100` transformation instead makes it byte-identical
   every time — one md5 identifies it exactly, and the check costs 6 KB a player
   rather than 160 KB. Verified against all 3,555 distinct URLs in the pool: it
   matched 1,829 and nothing else, every real photograph hashing uniquely.
2. **Fall back to ESPN.** nflverse's player table already carries `espn_id`
   beside the GSIS id, so no new feed is needed. ESPN honestly 404s what it does
   not hold, so a 200 there is a real photograph.
3. **Fall back to Wikipedia.** The only source that reaches pre-2009 players at
   all. English Wikipedia's Action API is asked for each player's article image,
   fifty titles to a request — the REST summary endpoint is one request per
   player and rate-limits hard enough to be unusable (measured: HTTP 429 for
   most of a 60-player sample, even issued serially).

   Candidates are accepted on the article's **short description**, not on the
   name. This matters: "Greg Clark" resolves to a British Conservative
   politician, whose portrait would otherwise be printed on a tight end's card.
   Anything not described as an American football player is dropped, which cost
   3% of candidates on a real sample and is the whole reason the lookup is safe.
   Players are tried at their plain name first and at `<name> (American
   football)` second, which is Wikipedia's own disambiguation convention.

   Wikipedia is deliberately last. An article photo may be a candid, in another
   team's uniform, or twenty years after the season on the card — worth far more
   than a team logo, but not more than nfl.com's own headshot.
4. **Record the absence.** What no source has is written as a null url with
   source `NONE`. That null is a result, not a gap — it is what sends the card to
   its team logo.

⚠️ **Licensing.** Wikimedia images are freely licensed but most are CC-BY-SA and
carry an attribution requirement. `NflPlayerHeadshot.source` records which
provider each URL came from, so the league can attribute them if the cards are
ever published outside it. The API's `utm_*` tracking query is stripped before
the URL is stored, so rendering a card sends no campaign beacon to Wikimedia.

nfl.com is preferred where it has a real picture: 1400×1000 against ESPN's
600×436. The aspect ratios are near-identical (1.40 vs 1.38) and both are
head-and-shoulders on a transparent ground, so the two sources sit together on a
card with no layout change.

### What that recovers

Of the 13,493 cards in the pool:

| | Cards | Share |
|---|---|---|
| Photograph | 11,578 | **85.8%** |
| No photograph anywhere — team logo | 1,915 | 14.2% |

Coverage by decade, which is the only axis that matters here:

| Decade | With a photograph |
|--------|-------------------|
| 2020s | 100% |
| 2010s | 100% |
| 2000s | 65% |
| 1990s | 36% |

Wikipedia added 256 players the CDNs could not place, taking the pool from 77.9%
to 85.8% illustrated and the 2000s from 45% to 65%. It recovered most of the
players anyone would recognise — Edgerrin James, Eddie George, Warrick Dunn,
Ricky Watters, Isaac Bruce, Jamal Lewis.

The residual 813 players are a floor rather than a backlog, and every remaining
avenue was measured before the pool was declared done:

| Source | Result on the 942 unresolved |
|--------|------------------------------|
| ESPN headshot CDN | 0/40 sampled — 404 for every one |
| ESPN combiner endpoint | 0/40 — same |
| Pro-Football-Reference | 403; forbids hotlinking |
| Sleeper | knows 0 of the 942; its database is modern-only |
| Wikimedia Commons | **256 recovered** |

From 2009 onward the pool is essentially fully illustrated; 2019+ was already
complete from nfl.com alone. What is left is genuinely obscure — a 2003 role
player nobody photographed.

Those 1,915 cards show their team logo, which is both identifiable in a grid and
era-correct in a way the black helmet never was. **No card ever renders an empty
frame**: the chain is portrait, then team logo, then the team's letters, and
every link is pinned by `tests/components/PlayerCard.test.tsx`.

---

## Layout

| Module | Responsibility |
|--------|----------------|
| `src/lib/cards/tiers.ts` | Every tunable number: cutoffs, recipes, drop odds |
| `src/lib/cards/pool.ts` | Derives cards from `NflWeeklyStat` and ranks them |
| `src/lib/cards/packs.ts` | Pack odds and dealing. Pure; takes an injected RNG |
| `src/lib/cards/roster.ts` | Lineup shape, slot eligibility, both PPG scores |
| `src/lib/cards/bonus.ts` | Sleeper win/high-score detection and awarding |
| `src/lib/cards/allowance.ts` | The weekly ration, the wildcard die, the grant |
| `src/lib/cards/service.ts` | Persistence: decks, standings, claiming a pack |
| `src/components/cards/` | Card art, pack opener, deck grid, standings, admin |

`packs.ts` holds the odds and knows nothing about Prisma; `service.ts` holds the
persistence and knows nothing about the odds. They meet in `openOnePack`. The
injected RNG is what makes the odds testable — a fixed seed turns "the odds are
right" into an exact assertion rather than a distribution check.

### Routes

| Route | Method | Who |
|-------|--------|-----|
| `/api/cards/collection` | GET | Signed in — also runs the Sleeper bonus check |
| `/api/cards/open` | POST | Signed in |
| `/api/cards/roster` | PUT | Signed in |
| `/api/cards/wildcard` | POST | Signed in |
| `/api/cards/leaderboard` | GET | Signed in |
| `/api/cards/pool` | GET / POST | Signed in / Commissioner |
| `/api/cards/reset` | POST | Commissioner |

`/api/cards/open` answers **409** when the ration is spent — the member is
entitled to open packs, they are simply out of them.

### Concurrency

Two different races, handled separately.

**The member's own balance.** Spending a pack is a conditional update, not a
read-then-write:

```ts
updateMany({ where: { …, packsOpened: { lt: fields.packsGranted } },
             data:  { packsOpened: { increment: 1 } } })
```

Two tabs clicking "open" together would both pass a `remaining > 0` check.
Putting the balance in the `where` lets SQLite arbitrate, and the loser is told
it has no packs left. The pack is credited only after the spend succeeds, so a
crash between the two costs a pack rather than duplicating one.

**Other members' claims.** The pool is read, then written to, and in between
someone else may take a card this pack drew. Each claim is attempted
individually against the unique index on `(gameSeason, cardId)`, and a lost one
is redrawn against a freshly-read pool, so a contested pack still comes back
with five cards rather than four.

⚠️ **The libSQL adapter does not reliably translate a SQLite constraint failure
into Prisma's `P2002`.** Under the driver adapter it arrives as a
`PrismaClientUnknownRequestError` carrying the raw `UNIQUE constraint failed`
text. `isUniqueViolation` in service.ts matches both shapes — checking the code
alone let a genuine race escape as a 500, which is exactly what happened the
first time two members opened packs simultaneously. Any new code that catches a
uniqueness error in this codebase needs the same treatment.

---

## Turso footprint

Measured against a partially backfilled database (14 seasons, 232k stat rows,
122 MB), projected to the full 1999–2025 range:

| | Projected | Notes |
|---|---|---|
| `NflWeeklyStat` rows | ~448,000 | 16,600 a season × 27 |
| Storage | **~237 MB** | ~554 bytes a stat row |
| `CardDefinition` | ~14,100 cards | avg 524 eligible players a season |
| Backfill writes | ~448,000 | one-off; weekly sync adds ~1,000 |

Storage and writes are not close to a constraint. **Row reads** are the number
worth watching, and two paths dominate:

- **Opening a pack scans the whole pool** — `loadAllCards` reads every
  `CardDefinition` row (id and tier only) to build the draw pool, plus the
  claimed-id set for the season. That is ~14,000 + up to ~10,000 rows per open
  once a season is underway. It is cached for an hour *per process*, so on
  serverless the cache is defeated by cold starts. Acceptable at current
  volumes; if it ever matters, the fix is to store the pool as a single JSON
  blob in `SleeperCache` — one row read instead of fourteen thousand.

- **Ranking a member means ranking everybody.** `readLeaderboard` runs three
  queries, two of them joins across `CardOwnership × CardDefinition`. This used
  to run **twice per page load** — once inside `readDeck` and again from a
  separate `/api/cards/leaderboard` fetch on the page. `readDeck` now returns
  the standings it already computed and the page makes one request. The
  `/leaderboard` route still exists for callers that want standings alone.

Deck reads are bounded by how many cards a member owns rather than by pool size,
so they do not grow when seasons are backfilled.

## Schema notes

`CardDefinition` is derived data, rebuilt wholesale. The three user-owned tables
(`CardOwnership`, `PackGrant`, `PackOpening`) reference cards by id as a plain
column **with no foreign key** — a `REFERENCES` constraint would either
cascade-delete decks on every rebuild or block the rebuild outright. The rebuild
reuses existing ids where a card still exists, and the read path drops an
ownership row whose card has gone.

`CardOwnership` is unique on `(gameSeason, cardId)` — **without** `userId`. That
omission is the exclusivity rule, and the database is what enforces it rather
than any application check. There is no `count` column because a duplicate
cannot happen.

## UI notes

The pack is opened by pulling the strip off the top — grip it and drag sideways,
the way you would open a real one. Pointer events, so mouse, finger and stylus
take one path; Enter or Space does the same for keyboard.

The reveal is then **one card on screen at a time, two clicks each**. The card
arrives face down but drawn in its own tier's metal — so a Gold announces itself
before you know who it is — and the first click turns it over, the second brings
up the next. Only when the last card has been dismissed is the whole pack laid
out together, which is the one point where seeing everything is useful rather
than a spoiler.

This applies to **every** pack, bonus packs included. There is no
"reveal all" shortcut: a shortcut makes the rule optional, which is the same as
not having it. Showing the pack as a row would give the best card away the
moment the wrapper came off.

⚠️ The drag gate is a **ref**, not React state. `pointermove` needs to know a
drag is in progress on the very next event, and a state update has not flushed
by then — a fast drag fires moves while the state is still `false` and every one
of them is dropped. The state is kept only for the cursor, which can lag a
frame.

The strip and the body are full-size copies of the same foil, each clipped to
one side of a straight `clip-path` at `TEAR_Y`. Drawing them at full size rather
than as two rectangles is what keeps the gradient continuous across the join, so
the wrapper looks whole until it is pulled — two rectangles would show a visible
step where their gradients restart.

The tear line is a row of punched holes, which doubles as the "pull here"
affordance. Each hole is a dark dot with a highlight under it: the shadow is the
hole, the highlight is the lit edge below it. They sit just *above* `TEAR_Y`
rather than centred on it, because the strip is clipped at exactly that line and
a hole straddling it would be sliced into a semicircle.

A card with no headshot falls back to its team's logo from ESPN's CDN, keyed on
nflverse's own abbreviations — which includes `LA` for the Rams and `WAS` for
Washington, both of which ESPN serves. All 32 were checked against the live CDN.
This is not a rare path: it is what roughly 3,000 pre-2009 cards show, and it is
the intended look for them — see **Portraits**.

⚠️ **Bare class selectors in `globals.css` are dropped by the build.** Only
`@keyframes` and rules inside `@media` blocks survive. Static styles for these
components are therefore written inline; the `.ut-*` classes exist purely as
hooks for the reduced-motion `@media` block, whose `!important` beats the inline
declarations. A flip styled through a class silently rendered every card
face-up.
