"""Covers the headshot resolver in scripts/sync_player_headshots.py.

The whole job turns on one judgement — "is this URL a photograph, or is it the
league's generic silhouette?" — and getting it wrong is silent in both
directions: a false positive puts a black helmet back on a card, a false
negative throws away a picture the game had. Both are pinned here.
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
        ) == ("00-0001", NFL_URL, "NFL")

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
        ) == ("00-0001", espn, "ESPN")

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
        ) == ("00-0001", None, "NONE")


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


class TestThumbnails:
    def _page(self, title, description, thumb):
        page = {"title": title, "description": description}
        if thumb:
            page["thumbnail"] = {"source": thumb}
        return page

    # WHY: the API normalises capitalisation, so the title that comes back is
    #      often not the one asked for. Keying on the lowercased title is what
    #      lets the caller find its player again.
    def test_keys_on_the_lowercased_title(self):
        payload = {"query": {"pages": [
            self._page("Eddie George", "American football player", "https://u/e.jpg"),
        ]}}
        assert headshots._thumbnails(payload) == {"eddie george": "https://u/e.jpg"}

    # WHY: a page with no lead image is not a photograph. Returning the article
    #      anyway would write a null url under a WIKIPEDIA source, which reads
    #      as "we found one" everywhere downstream.
    def test_drops_a_page_with_no_image(self):
        payload = {"query": {"pages": [
            self._page("Milton Wynn", "American football player", None),
        ]}}
        assert headshots._thumbnails(payload) == {}

    def test_drops_a_page_about_someone_else(self):
        payload = {"query": {"pages": [
            self._page("Greg Clark", "British Conservative politician", "https://u/g.jpg"),
        ]}}
        assert headshots._thumbnails(payload) == {}

    def test_drops_a_missing_page(self):
        payload = {"query": {"pages": [{"title": "Nobody", "missing": True}]}}
        assert headshots._thumbnails(payload) == {}

    # WHY: redirects are reported separately from pages, so without this the
    #      requested name would find nothing even though the article was
    #      fetched and did have an image.
    def test_maps_a_redirect_back_to_the_requested_title(self):
        payload = {
            "query": {
                "pages": [self._page("Duce Staley", "American football player", "https://u/d.jpg")],
                "redirects": [{"from": "Duce staley", "to": "Duce Staley"}],
            }
        }
        assert headshots._thumbnails(payload)["duce staley"] == "https://u/d.jpg"

    # WHY: an unanswered batch must not look like an answered-but-empty one.
    def test_handles_a_failed_request(self):
        assert headshots._thumbnails(None) == {}


class TestApplyWikipedia:
    NAMES = {"p1": "Eddie George", "p2": "Milton Wynn", "p3": "Kurt Warner"}

    # WHY: Wikipedia is the weakest source, so it must only ever fill gaps.
    #      Overwriting an nfl.com portrait with an article photo would swap a
    #      posed headshot for a candid twenty years after the fact.
    def test_leaves_resolved_players_alone(self, monkeypatch):
        monkeypatch.setattr(headshots, "wikipedia_photos",
                            lambda names: {"p1": "https://u/e.jpg"})
        resolved = [
            ("p1", None, "NONE"),
            ("p3", "https://nfl/w.png", "NFL"),
        ]
        out = dict((p, (u, s)) for p, u, s in
                   headshots.apply_wikipedia(resolved, self.NAMES))
        assert out["p1"] == ("https://u/e.jpg", "WIKIPEDIA")
        assert out["p3"] == ("https://nfl/w.png", "NFL")

    # WHY: a player Wikipedia cannot place stays NONE, which is what lets the
    #      card fall back to its team logo.
    def test_leaves_an_unfound_player_as_none(self, monkeypatch):
        monkeypatch.setattr(headshots, "wikipedia_photos", lambda names: {})
        out = headshots.apply_wikipedia([("p2", None, "NONE")], self.NAMES)
        assert out == [("p2", None, "NONE")]

    # WHY: no unresolved players means no reason to call Wikipedia at all.
    def test_skips_the_lookup_when_everything_resolved(self, monkeypatch):
        def explode(names):
            raise AssertionError("should not have asked Wikipedia")
        monkeypatch.setattr(headshots, "wikipedia_photos", explode)
        resolved = [("p1", "https://nfl/a.png", "NFL")]
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
