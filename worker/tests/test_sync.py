from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pigeonhole_worker.sync import PlaylistTrackRecord, TrackRecord, parse_track, run_sync

# ── fixtures (sanitized shapes matching the real API) ────────────────────


def raw_track(track_id: str, artist_id: str = "art1", **overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "id": track_id,
        "name": f"Track {track_id}",
        "artists": [{"id": artist_id, "name": f"Artist {artist_id}"}],
        "album": {"name": "Album", "release_date": "2020-01-15"},
        "popularity": 40,
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
        "snapshot_id": snapshot,
        "tracks": {"total": 1},
        "owner": {"id": owner},
        "collaborative": False,
    }


def item(track: dict[str, Any] | None, added_at: str = "2024-01-01T00:00:00Z") -> dict[str, Any]:
    return {"track": track, "added_at": added_at}


class FakeSpotify:
    """Duck-typed stand-in for SpotifyClient."""

    def __init__(
        self,
        playlists: list[dict[str, Any]],
        playlist_items: dict[str, list[dict[str, Any]]],
        saved_items: list[dict[str, Any]] | None = None,
        artists: dict[str, dict[str, Any]] | None = None,
    ) -> None:
        self.playlists = playlists
        self.playlist_items = playlist_items
        self.saved_items = saved_items or []
        self.artists = artists or {}
        self.track_fetches: list[str] = []
        self.artist_requests: list[list[str]] = []

    def get_my_playlists(self) -> list[dict[str, Any]]:
        return self.playlists

    def get_playlist_tracks(self, playlist_id: str) -> list[dict[str, Any]]:
        self.track_fetches.append(playlist_id)
        return self.playlist_items[playlist_id]

    def get_saved_tracks(self) -> list[dict[str, Any]]:
        return self.saved_items

    def get_artists(self, ids: list[str]) -> list[dict[str, Any]]:
        self.artist_requests.append(ids)
        return [self.artists.get(i, {"id": i, "name": i, "genres": []}) for i in ids]


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

    def known_artist_ids(self) -> set[str]:
        return set(self.artists)

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
    assert record.release_year == 2020


def test_parse_track_rejects_local_and_null() -> None:
    assert parse_track(None) is None
    assert parse_track(raw_track("t1", is_local=True)) is None
    assert parse_track({"id": None, "name": "ghost"}) is None


def test_parse_track_handles_missing_release_date() -> None:
    record = parse_track(raw_track("t1", album={"name": "A"}))
    assert record is not None
    assert record.release_year is None


# ── full sync ────────────────────────────────────────────────────────────


def test_full_sync_persists_everything() -> None:
    spotify = FakeSpotify(
        playlists=[playlist_payload("p1", "snap1"), playlist_payload("p2", "snap2", owner="other")],
        playlist_items={
            "p1": [item(raw_track("t1", "art1")), item(raw_track("t2", "art2"))],
            "p2": [item(raw_track("t3", "art1"))],
        },
        saved_items=[item(raw_track("t4", "art3"))],
        artists={"art1": {"id": "art1", "name": "One", "genres": ["indie rock"]}},
    )
    repo = FakeRepo()
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.playlists_seen == 2
    assert stats.playlists_synced == 2
    assert stats.tracks_upserted == 3
    assert stats.saved_tracks == 1
    assert set(repo.tracks) == {"t1", "t2", "t3", "t4"}
    assert repo.playlists["p1"]["is_owned"] is True
    assert repo.playlists["p2"]["is_owned"] is False
    assert [e.track_id for e in repo.playlist_tracks["p1"]] == ["t1", "t2"]
    assert [e.track_id for e in repo.saved] == ["t4"]
    assert set(repo.artists) == {"art1", "art2", "art3"}
    assert repo.synced_at is not None


def test_incremental_sync_skips_unchanged_snapshots() -> None:
    spotify = FakeSpotify(
        playlists=[playlist_payload("p1", "snap1"), playlist_payload("p2", "snap2-new")],
        playlist_items={"p2": [item(raw_track("t9"))]},
    )
    repo = FakeRepo(snapshots={"p1": "snap1", "p2": "snap2-old"})
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.playlists_skipped == 1
    assert stats.playlists_synced == 1
    assert spotify.track_fetches == ["p2"]  # p1 never re-fetched


def test_sync_skips_local_and_unavailable_tracks() -> None:
    spotify = FakeSpotify(
        playlists=[playlist_payload("p1", "snap1")],
        playlist_items={
            "p1": [item(raw_track("t1")), item(raw_track("t2", is_local=True)), item(None)]
        },
    )
    repo = FakeRepo()
    stats = run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert stats.skipped_items == 2
    assert [e.track_id for e in repo.playlist_tracks["p1"]] == ["t1"]
    # positions stay contiguous after skips
    assert [e.position for e in repo.playlist_tracks["p1"]] == [0]


def test_artists_fetched_only_when_unknown() -> None:
    spotify = FakeSpotify(
        playlists=[playlist_payload("p1", "snap1")],
        playlist_items={
            "p1": [item(raw_track("t1", "art-known")), item(raw_track("t2", "art-new"))]
        },
    )
    repo = FakeRepo()
    repo.artists["art-known"] = {"id": "art-known"}
    run_sync(repo, spotify, "user-1", "owner-spotify")  # type: ignore[arg-type]

    assert spotify.artist_requests == [["art-new"]]


def test_sync_passes_explicit_timestamp() -> None:
    spotify = FakeSpotify(playlists=[], playlist_items={})
    repo = FakeRepo()
    at = datetime(2026, 7, 30, 12, 0, 0, tzinfo=UTC)
    run_sync(repo, spotify, "user-1", "owner-spotify", now=at)  # type: ignore[arg-type]
    assert repo.synced_at == at
