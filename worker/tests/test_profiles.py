from __future__ import annotations

from datetime import UTC, datetime

from pigeonhole_worker.profiles import build_profile

D2020 = datetime(2020, 1, 1, tzinfo=UTC)
D2021 = datetime(2021, 6, 15, tzinfo=UTC)
D2023 = datetime(2023, 3, 10, tzinfo=UTC)


def test_artist_weights_are_track_fractions() -> None:
    tracks = [
        (["a1"], 2020, None),
        (["a1"], 2021, None),
        (["a2"], 2019, None),
        (["a1", "a2"], 2020, None),
    ]
    profile = build_profile("p", tracks)
    assert profile.track_count == 4
    # a1 on 3 of 4 tracks, a2 on 2 of 4
    assert profile.artist_weights["a1"] == 0.75
    assert profile.artist_weights["a2"] == 0.5


def test_duplicate_artist_within_track_counts_once() -> None:
    profile = build_profile("p", [(["a1", "a1"], 2020, None)])
    assert profile.artist_weights == {"a1": 1.0}


def test_era_mean_and_std() -> None:
    profile = build_profile("p", [([], 2010, None), ([], 2020, None)])
    assert profile.era_mean == 2015.0
    assert profile.era_std == 5.0  # population std of {2010, 2020}
    assert profile.era_count == 2


def test_single_year_has_zero_std() -> None:
    profile = build_profile("p", [(["a1"], 2018, None)])
    assert profile.era_mean == 2018.0
    assert profile.era_std == 0.0
    assert profile.era_count == 1


def test_tracks_without_years_excluded_from_era() -> None:
    profile = build_profile("p", [(["a1"], None, None), (["a1"], 2020, None)])
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
    assert profile.oldest_track_added_at is None
    assert profile.newest_track_added_at is None


def test_recency_takes_min_and_max_of_added_at() -> None:
    profile = build_profile(
        "p",
        [
            (["a1"], 2020, D2021),
            (["a1"], 2020, D2020),
            (["a1"], 2020, D2023),
        ],
    )
    assert profile.oldest_track_added_at == D2020
    assert profile.newest_track_added_at == D2023


def test_recency_ignores_tracks_with_no_added_at() -> None:
    profile = build_profile("p", [(["a1"], 2020, None), (["a1"], 2020, D2021)])
    assert profile.oldest_track_added_at == D2021
    assert profile.newest_track_added_at == D2021


def test_recency_none_when_no_track_has_added_at() -> None:
    profile = build_profile("p", [(["a1"], 2020, None)])
    assert profile.oldest_track_added_at is None
    assert profile.newest_track_added_at is None
