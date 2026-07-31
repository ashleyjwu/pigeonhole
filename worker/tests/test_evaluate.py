from __future__ import annotations

from pigeonhole_worker.evaluate import PlacementTrack, evaluate_placements


def track(track_id: str, *artists: str, year: int | None = 2020) -> PlacementTrack:
    return PlacementTrack(track_id, tuple(artists), year)


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
