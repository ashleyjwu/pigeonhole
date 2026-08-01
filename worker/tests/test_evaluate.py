from __future__ import annotations

from datetime import UTC, datetime, timedelta

from pigeonhole_worker.evaluate import PlacementTrack, evaluate_placements, filter_by_age

NOW = datetime(2026, 7, 31, tzinfo=UTC)
RECENT = NOW - timedelta(days=30)
OLD = NOW - timedelta(days=365 * 5)


def track(
    track_id: str,
    *artists: str,
    year: int | None = 2020,
    added_at: datetime | None = None,
) -> PlacementTrack:
    return PlacementTrack(track_id, tuple(artists), year, added_at)


def test_dominant_artist_ranks_home_first() -> None:
    playlists = {
        # home: 3 of 4 tracks by artist "x"
        "home": [track("t1", "x"), track("t2", "x"), track("t3", "x"), track("t4", "y")],
        "other": [track("o1", "z"), track("o2", "z")],
    }
    report = evaluate_placements(playlists)
    assert report.placements == 6
    # every "x" track held out still finds 2 other "x" tracks at home
    assert report.hits_at_1 >= 3
    assert report.hit_rate_at_3 > 0.5


def test_leave_one_out_excludes_held_track_from_home_profile() -> None:
    # home has one track per artist and NO year data (isolates the artist
    # signal). Held out, a track's artist vanishes from the home profile, so
    # home must score 0 (unranked) — with leakage it would score 1.0.
    playlists = {
        "home": [track("t1", "a", year=None), track("t2", "b", year=None)],
        "distractor": [track("d1", "a", year=None), track("d2", "a", year=None)],
    }
    report = evaluate_placements(playlists)
    home = report.by_playlist["home"]
    assert home.hits_at_3 == 0  # with leakage, home would rank top for both
    assert report.unranked == 2  # both home tracks: home profile has no signal


def test_small_playlists_skipped_as_sources_but_compete() -> None:
    playlists = {
        "single": [track("s1", "q", year=2020)],
        "home": [track("t1", "q"), track("t2", "q")],
    }
    report = evaluate_placements(playlists)
    # 'single' contributes no placements (too small to hold out from)
    assert "single" not in report.by_playlist
    assert report.by_playlist["home"].placements == 2
    # 'single' still competes as a candidate: it also has artist q at weight
    # 1.0, tying home's leave-one-out profile. The deterministic tie-break
    # (playlist_id asc) puts 'home' first, so both placements are hits.
    assert report.hits_at_1 == 2
    assert report.hits_at_3 == 2


def test_no_signal_counts_as_unranked_not_lucky_hit() -> None:
    playlists = {
        "home": [track("t1", "a", year=None), track("t2", "b", year=None)],
        "other": [track("o1", "c", year=None), track("o2", "d", year=None)],
    }
    report = evaluate_placements(playlists)
    assert report.placements == 4
    assert report.unranked == 4
    assert report.hits_at_1 == 0
    assert report.mrr == 0.0


def test_deterministic_tiebreak_by_playlist_id() -> None:
    # Both candidates end with identical scores for the held-out track;
    # ranking must be stable and deterministic (playlist_id ascending).
    playlists = {
        "aaa": [track("t1", "x"), track("t2", "x")],
        "bbb": [track("u1", "x"), track("u2", "x")],
    }
    report = evaluate_placements(playlists)
    # For each held-out track: home (leave-one-out weight 1.0 from 1 track)
    # ties with the other playlist (weight 1.0 from 2 tracks).
    # 'aaa' wins ties, 'bbb' loses them -> aaa hits@1 twice, bbb ranks 2nd.
    assert report.by_playlist["aaa"].hits_at_3 == 2
    assert report.by_playlist["bbb"].hits_at_3 == 2
    assert report.hits_at_1 == 2


def test_metrics_math() -> None:
    playlists = {
        "home": [track("t1", "x"), track("t2", "x")],
    }
    report = evaluate_placements(playlists)
    assert report.placements == 2
    assert report.hits_at_1 == 2
    assert report.mrr == 1.0
    assert report.mean_rank == 1.0


def test_recency_boost_can_break_a_tie_between_equally_relevant_playlists() -> None:
    # Both playlists share the held-out track's artist with identical
    # leave-one-out weight (1 of 1 remaining track) — a pure content tie.
    # Only "active" was recently updated, so it must win the tie instead of
    # falling back to the alphabetical tiebreak ("stale" would win on name).
    playlists = {
        "stale": [track("s1", "x", added_at=OLD), track("s2", "x", added_at=OLD)],
        "active": [track("a1", "x", added_at=RECENT), track("a2", "x", added_at=RECENT)],
    }
    report = evaluate_placements(playlists, now=NOW)
    assert report.by_playlist["active"].hits_at_3 == 2
    assert report.hits_at_1 == 2  # both held-out "active" tracks rank home 1st


def test_recency_boost_does_not_override_a_stronger_content_match() -> None:
    # "recent" shares no artist with "relevant"'s tracks and is too small to
    # be a hold-out source itself (still competes as a candidate, per
    # test_small_playlists_skipped_as_sources_but_compete). For every
    # placement held out from "relevant", "recent" has zero artist overlap,
    # so its score is 0 regardless of its recency boost (multiplicative:
    # 0 * boost = 0) — content relevance must still win.
    playlists = {
        "recent": [track("r1", "y", added_at=RECENT)],
        "relevant": [track("v1", "x", added_at=OLD), track("v2", "x", added_at=OLD)],
    }
    report = evaluate_placements(playlists, now=NOW)
    assert "recent" not in report.by_playlist  # too small to be a source
    assert report.by_playlist["relevant"].hits_at_3 == 2


# ── age filtering ────────────────────────────────────────────────────────


def test_filter_by_age_keeps_recently_created_playlists() -> None:
    playlists = {
        "young": [track("t1", "x", added_at=RECENT)],
        "old": [track("t2", "x", added_at=OLD)],
    }
    kept = filter_by_age(playlists, max_age_years=3, now=NOW)
    assert set(kept) == {"young"}


def test_filter_by_age_uses_oldest_addition_not_newest() -> None:
    # A playlist created long ago but touched recently is still "old" by
    # creation-proxy age, even though its newest add is recent.
    playlists = {
        "actually-old": [track("t1", "x", added_at=OLD), track("t2", "x", added_at=RECENT)],
    }
    kept = filter_by_age(playlists, max_age_years=3, now=NOW)
    assert "actually-old" not in kept


def test_filter_by_age_drops_undated_playlists() -> None:
    playlists = {"undated": [track("t1", "x", added_at=None)]}
    kept = filter_by_age(playlists, max_age_years=3, now=NOW)
    assert kept == {}


def test_filter_by_age_drops_playlists_with_only_some_undated_tracks_using_dated_ones() -> None:
    # A playlist with a mix: age is judged from whichever tracks DO have a
    # date (the oldest of those), not disqualified just for having some None.
    playlists = {"mixed": [track("t1", "x", added_at=None), track("t2", "x", added_at=RECENT)]}
    kept = filter_by_age(playlists, max_age_years=3, now=NOW)
    assert "mixed" in kept


def test_evaluate_with_max_age_years_excludes_old_playlists_as_sources_and_candidates() -> None:
    playlists = {
        "young": [track("y1", "x", added_at=RECENT), track("y2", "x", added_at=RECENT)],
        "old": [track("o1", "x", added_at=OLD), track("o2", "x", added_at=OLD)],
    }
    report = evaluate_placements(playlists, now=NOW, max_age_years=3)
    # "old" contributes no placements (excluded as a source)...
    assert "old" not in report.by_playlist
    assert report.placements == 2  # only "young"'s 2 tracks were evaluated
    # ...and every "young" placement's top match is "young" itself, since
    # "old" never competes as a candidate either.
    assert report.hits_at_1 == 2
