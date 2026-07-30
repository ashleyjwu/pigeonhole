from __future__ import annotations

from pigeonhole_worker.profiles import build_profile


def test_artist_weights_are_track_fractions() -> None:
    tracks = [
        (["a1"], 2020),
        (["a1"], 2021),
        (["a2"], 2019),
        (["a1", "a2"], 2020),
    ]
    profile = build_profile("p", tracks)
    assert profile.track_count == 4
    # a1 on 3 of 4 tracks, a2 on 2 of 4
    assert profile.artist_weights["a1"] == 0.75
    assert profile.artist_weights["a2"] == 0.5


def test_duplicate_artist_within_track_counts_once() -> None:
    profile = build_profile("p", [(["a1", "a1"], 2020)])
    assert profile.artist_weights == {"a1": 1.0}


def test_era_mean_and_std() -> None:
    profile = build_profile("p", [([], 2010), ([], 2020)])
    assert profile.era_mean == 2015.0
    assert profile.era_std == 5.0  # population std of {2010, 2020}
    assert profile.era_count == 2


def test_single_year_has_zero_std() -> None:
    profile = build_profile("p", [(["a1"], 2018)])
    assert profile.era_mean == 2018.0
    assert profile.era_std == 0.0
    assert profile.era_count == 1


def test_tracks_without_years_excluded_from_era() -> None:
    profile = build_profile("p", [(["a1"], None), (["a1"], 2020)])
    assert profile.era_count == 1
    assert profile.era_mean == 2020.0
    assert profile.artist_weights["a1"] == 1.0  # both tracks still count for artist


def test_empty_playlist() -> None:
    profile = build_profile("p", [])
    assert profile.track_count == 0
    assert profile.artist_weights == {}
    assert profile.era_mean is None
    assert profile.era_std is None
    assert profile.era_count == 0
