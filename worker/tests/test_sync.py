from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pigeonhole_worker.sync import (
    PlaylistTrackRecord,
    TrackRecord,
    parse_playlist_image_url,
    parse_track,
    run_sync,
)

# ── fixtures (sanitized shapes matching the Feb-2026 API) ────────────────


def raw_track(track_id: str, artist_id: str = "art1", **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": track_id,
        "name": f"Track {track_id}",
        "artists": [{"id": artist_id, "name": f"Artist {artist_id}"}],
        "album": {"name": "Album", "release_date": "2020-01-15"},
        "explicit": False,
        "duration_ms": 180_000,
        "is_local": False,
    }
    base.update(overrides)
    return base


def playlist_payload(
    playlist_id: str, snapshot: str, owner: str = "owner-spotify"
) -> dict[str, Any]:
    return {
        "id": playlist_id,
        "name": f"Playlist {playlist_id}",
        "description": "",
        "images": [{"url": f"https://example.com/{playlist_id}.jpg"}],
        "snapshot_id": snapshot,
        "items": {"total": 1},  # renamed from `tracks` in Feb-2026 API
        "owner": {"id": owner},
        "collaborative": False,
    }


def playlist_entry(
    track: dict[str, Any] | None, added_at: str = "2024-01-01T00:00:00Z"
) -> dict[str, Any]:
    """Playlist entries nest the track under `item` (Feb-2026 rename)."""
    return {"item": track, "added_at": added_at, "is_local": False}


def saved_entry(
    track: dict[str, Any] | None, added_at: str = "2024-01-01T00:00:00Z"
) -> dict[str, Any]:
    """Saved-track entries still use the `track` key."""
    return {"track": track, "added_at": added_at}


class FakeSpotify:
    """Duck-typed stand-in for SpotifyClient."""

    def __init__(
        self,
        playlists: list[dict[str, Any]],
        playlist_items: dict[str, list[dict[str, Any]]],
        saved_items: list[dict[str, Any]] | None = None,
    ) -> None:
        self.playlists = playlists
        self.playlist_items = playlist_items
        self.saved_items = saved_items or []
        self.item_fetches: list[str] = []

    def get_my_playlists(self) -> list[dict[str, Any]]:
        return self.playlists

    def get_playlist_items(self, playlist_id: str) -> list[dict[str, Any]]:
        self.item_fetches.append(playlist_id)
        return self.playlist_items[playlist_id]

    def get_saved_tracks(self) -> list[dict[str, Any]]:
        return self.saved_items


class FakeRepo:
    def __init__(self, snapshots: dict[str, str] | None = None) -> None:
        self.snapshots = snapshots or {}
        self.playlists: dict[str, dict[str, Any]] = {}
        self.tracks: dict[str, TrackRecord] = {}
        self.playlist_tracks: dict[str, list[PlaylistTrackRecord]] = {}
        self.saved: list[PlaylistTrackRecord] = []
        self.artists: dict[str, dict[str, Any]] = {}
        self.synced_at: datetime | None = None

    def get_playlist_snapshots(self, user_id: str) -> dict[str, str]:
        return dict(self.snapshots)

    def upsert_playlist(self, user_id: str, playlist: dict[str, Any], is_owned: bool) -> None:
        self.playlists[playlist["id"]] = {**playlist, "is_owned": is_owned}

    def upsert_tracks(self, tracks: list[TrackRecord]) -> None:
        for t in tracks:
            self.tracks[t.spotify_id] = t

    def replace_playlist_tracks(self, playlist_id: str, entries: list[PlaylistTrackRecord]) -> None:
        self.playlist_tracks[playlist_id] = entries

    def mark_playlist_synced(self, playlist_id: str, snapshot_id: str) -> None:
        self.snapshots[playlist_id] = snapshot_id

    def replace_saved_tracks(self, user_id: str, entries: list[PlaylistTrackRecord]) -> None:
        self.saved = entries

    def upsert_artists(self, artists: list[dict[str, Any]]) -> None:
        for a in artists:
            self.artists[a["id"]] = a

    def mark_user_synced(self, user_id: str, at: datetime) -> None:
        self.synced_at = at


# ── parse_track ──────────────────────────────────────────────────────────


def test_parse_track_maps_fields() -> None:
    record = parse_track(raw_track("t1"))
    assert record is not None
    assert record.spotify_id == "t1"
    assert record.artist_ids == ["art1"]
    assert record.artist_names == ["Artist art1"]
    assert record.release_year == 2020


def test_parse_track_rejects_local_and_null() -> None:
    assert parse_track(None) is None
    assert parse_track(raw_track("t1", is_local=True)) is None
    assert parse_track({"id": None, "name": "ghost"}) is None


def test_parse_track_handles_missing_release_date() -> None:
    record = parse_track(raw_track("t1", album={"name": "A"}))
    assert record is not None
    assert record.release_year is None


# ── parse_playlist_image_url ────────────────────────────────────────────


def test_parse_playlist_image_url_takes_the_first_image() -> None:
    playlist = {
        "images": [
            {"url": "https://example.com/large.jpg", "height": 640},
            {"url": "https://example.com/small.jpg", "height": 64},
        ]
    }
    assert parse_playlist_image_url(playlist) == "https://example.com/large.jpg"


def test_parse_playlist_image_url_none_when_no_images() -> None:
    assert parse_playlist_image_url({"images": []}) is None
    assert parse_playlist_image_url({}) is None
    assert parse_playlist_image_url({"images": None}) is None


def test_parse_playlist_image_url_none_when_url_missing_or_empty() -> None:
    assert parse_playlist_image_url({"images": [{"height": 640}]}) is None
    assert parse_playlist_image_url({"images": [{"url": ""}]}) is None


# ── full sync ────────────────────────────────────────────────────────────


def test_full_sync_persists_everything() -> None:
    collab = playlist_payload("p2", "snap2", owner="other")
    collab["collaborative"] = True  # foreign but collaborative -> still synced
    spotify = FakeSpotify(
        playlists=[
            playlist_payload("p1", "snap1"),
            collab,
        ],
        playlist_items={
            "p1": [
                playlist_entry(raw_track("t1", "art1")),
                playlist_entry(raw_track("t2", "art2")),
            ],
            "p2": [playlist_entry(raw_track("t3", "art1"))],
        },
        saved_items=[saved_entry(raw_track("t4", "art3"))],
    )
    repo = FakeRepo()
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.playlists_seen == 2
    assert stats.playlists_synced == 2
    assert stats.tracks_upserted == 3
    assert stats.saved_tracks == 1
    assert stats.artists_upserted == 3
    assert set(repo.tracks) == {"t1", "t2", "t3", "t4"}
    assert repo.playlists["p1"]["is_owned"] is True
    assert repo.playlists["p2"]["is_owned"] is False
    # raw playlist payload (incl. images, for the repository to extract
    # image_url from) is passed through to upsert_playlist untouched
    assert repo.playlists["p1"]["images"] == [{"url": "https://example.com/p1.jpg"}]
    assert [e.track_id for e in repo.playlist_tracks["p1"]] == ["t1", "t2"]
    assert [e.track_id for e in repo.saved] == ["t4"]
    # artists harvested from embedded track data (id + name)
    assert set(repo.artists) == {"art1", "art2", "art3"}
    assert repo.artists["art1"]["name"] == "Artist art1"
    assert repo.synced_at is not None


def test_foreign_playlists_are_not_ingested_at_all() -> None:
    spotify = FakeSpotify(
        playlists=[
            playlist_payload("mine", "snap1"),
            playlist_payload("followed", "snap9", owner="someone-else"),
        ],
        playlist_items={"mine": [playlist_entry(raw_track("t1"))]},
    )
    repo = FakeRepo()
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.playlists_foreign == 1
    assert spotify.item_fetches == ["mine"]  # never touched the followed one
    assert "followed" not in repo.playlists  # no metadata row either
    assert "followed" not in repo.playlist_tracks


def test_incremental_sync_skips_unchanged_snapshots() -> None:
    spotify = FakeSpotify(
        playlists=[playlist_payload("p1", "snap1"), playlist_payload("p2", "snap2-new")],
        playlist_items={"p2": [playlist_entry(raw_track("t9"))]},
    )
    repo = FakeRepo(snapshots={"p1": "snap1", "p2": "snap2-old"})
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.playlists_skipped == 1
    assert stats.playlists_synced == 1
    assert spotify.item_fetches == ["p2"]  # p1 never re-fetched


def test_sync_skips_local_and_unavailable_tracks() -> None:
    local_entry = playlist_entry(raw_track("t2"))
    local_entry["is_local"] = True
    spotify = FakeSpotify(
        playlists=[playlist_payload("p1", "snap1")],
        playlist_items={"p1": [playlist_entry(raw_track("t1")), local_entry, playlist_entry(None)]},
    )
    repo = FakeRepo()
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.skipped_items == 2
    assert [e.track_id for e in repo.playlist_tracks["p1"]] == ["t1"]
    # positions stay contiguous after skips
    assert [e.position for e in repo.playlist_tracks["p1"]] == [0]


def test_sync_passes_explicit_timestamp() -> None:
    spotify = FakeSpotify(playlists=[], playlist_items={})
    repo = FakeRepo()
    at = datetime(2026, 7, 30, 12, 0, 0, tzinfo=UTC)
    run_sync(repo, spotify, "user-1", "owner-spotify", now=at)  # type: ignore[arg-type]
    assert repo.synced_at == at
