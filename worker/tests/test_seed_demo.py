from __future__ import annotations

import random

from pigeonhole_worker.seed_demo import (
    DemoTrack,
    cluster_tracks,
    decade_of,
    merge_track_tags,
    playlist_description,
    playlist_name,
    primary_genre,
    split_held_out,
)


def track(track_id: str, tags: dict[str, float], year: int | None = 2015) -> DemoTrack:
    return DemoTrack(track_id=track_id, artist_ids=["a1"], release_year=year, tags=tags)


# ── merge_track_tags ──────────────────────────────────────────────────────


def test_merge_track_tags_takes_max_per_tag() -> None:
    merged = merge_track_tags([{"indie": 0.4, "rock": 1.0}, {"indie": 0.9, "pop": 0.2}])
    assert merged == {"indie": 0.9, "rock": 1.0, "pop": 0.2}


def test_merge_track_tags_empty() -> None:
    assert merge_track_tags([]) == {}
    assert merge_track_tags([{}, {}]) == {}


# ── primary_genre ─────────────────────────────────────────────────────────


def test_primary_genre_is_argmax() -> None:
    assert primary_genre({"indie": 0.4, "dream pop": 1.0}) == "dream pop"


def test_primary_genre_none_when_empty() -> None:
    assert primary_genre({}) is None


def test_primary_genre_tie_broken_alphabetically() -> None:
    # Deterministic: equal weights -> alphabetically first.
    assert primary_genre({"rock": 1.0, "indie": 1.0}) == "indie"


# ── decade_of ─────────────────────────────────────────────────────────────


def test_decade_of() -> None:
    assert decade_of(2015) == 2010
    assert decade_of(2009) == 2000
    assert decade_of(1998) == 1990
    assert decade_of(None) is None


# ── naming ────────────────────────────────────────────────────────────────


def test_playlist_name_is_deterministic() -> None:
    assert playlist_name("indie rock", None) == playlist_name("indie rock", None)


def test_playlist_name_includes_decade_when_present() -> None:
    name = playlist_name("indie rock", 2010)
    assert "2010s" in name
    assert name.endswith("indie rock")


def test_playlist_name_omits_decade_when_none() -> None:
    assert "s " not in playlist_name("jazz", None).replace("after-hours ", "")
    assert playlist_name("jazz", None).endswith("jazz")


def test_playlist_description_mentions_genre_and_count() -> None:
    desc = playlist_description("shoegaze", 12)
    assert "shoegaze" in desc
    assert "12" in desc


# ── cluster_tracks ────────────────────────────────────────────────────────


def test_cluster_groups_by_primary_genre() -> None:
    tracks = [track(f"i{n}", {"indie": 1.0}) for n in range(10)] + [
        track(f"j{n}", {"jazz": 1.0}) for n in range(10)
    ]
    playlists, leftover = cluster_tracks(tracks, min_size=8, max_size=60)
    genres = {p.genre for p in playlists}
    assert genres == {"indie", "jazz"}
    assert leftover == []


def test_cluster_sends_untagged_tracks_to_leftover() -> None:
    tracks = [track(f"i{n}", {"indie": 1.0}) for n in range(10)] + [
        track("x1", {}),
        track("x2", {}),
    ]
    playlists, leftover = cluster_tracks(tracks, min_size=8, max_size=60)
    assert len(playlists) == 1
    assert set(leftover) == {"x1", "x2"}


def test_cluster_sends_small_genres_to_leftover() -> None:
    tracks = [track(f"i{n}", {"indie": 1.0}) for n in range(10)] + [
        track(f"j{n}", {"jazz": 1.0}) for n in range(3)  # below min_size
    ]
    playlists, leftover = cluster_tracks(tracks, min_size=8, max_size=60)
    assert [p.genre for p in playlists] == ["indie"]
    assert set(leftover) == {"j0", "j1", "j2"}


def test_cluster_splits_oversized_genre_by_decade() -> None:
    tracks = [track(f"a{n}", {"pop": 1.0}, year=2015) for n in range(10)] + [
        track(f"b{n}", {"pop": 1.0}, year=2005) for n in range(10)
    ]
    playlists, leftover = cluster_tracks(tracks, min_size=8, max_size=15)
    decades = sorted(p.decade for p in playlists if p.decade is not None)
    assert decades == [2000, 2010]
    assert leftover == []


def test_cluster_keeps_oversized_genre_whole_when_no_decade_big_enough() -> None:
    # 20 pop tracks spread 5 years apart so each decade holds only ~2 —
    # no decade reaches min_size, so the genre is kept whole.
    tracks = [track(f"p{n}", {"pop": 1.0}, year=1980 + n * 5) for n in range(20)]
    playlists, leftover = cluster_tracks(tracks, min_size=8, max_size=15)
    assert len(playlists) == 1
    assert playlists[0].genre == "pop"
    assert playlists[0].decade is None
    assert len(playlists[0].track_ids) == 20
    assert leftover == []


# ── split_held_out ────────────────────────────────────────────────────────


def test_split_held_out_partitions_all_ids() -> None:
    placed, held = split_held_out([f"t{n}" for n in range(20)], 0.15, random.Random(1))
    assert len(held) == 3  # int(20 * 0.15)
    assert len(placed) == 17
    assert set(placed) | set(held) == {f"t{n}" for n in range(20)}
    assert set(placed).isdisjoint(held)


def test_split_held_out_zero_when_tiny() -> None:
    placed, held = split_held_out(["t0", "t1"], 0.15, random.Random(1))
    assert held == []
    assert set(placed) == {"t0", "t1"}
