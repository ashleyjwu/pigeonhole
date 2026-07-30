"""Library ingestion: pull a user's Spotify library into Postgres.

The algorithm (see spec design):
  1. Page through the user's playlists; upsert playlist rows.
  2. For each playlist whose ``snapshot_id`` changed since the last sync,
     re-fetch its tracks and replace the playlist_tracks set. Unchanged
     playlists are skipped entirely.
  3. Replace the user's saved ("liked") tracks set.
  4. Batch-fetch genres for any artists not yet known.

Persistence goes through the ``Repository`` protocol so the orchestration is
unit-testable with an in-memory fake; the SQL lives in ``repo.py``. Each
playlist is persisted independently, so an interrupted sync resumes where it
left off (already-synced playlists are skipped by snapshot on the next run).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from pigeonhole_worker.spotify import SpotifyClient


@dataclass(frozen=True)
class TrackRecord:
    spotify_id: str
    name: str
    artist_ids: list[str]
    album_name: str | None
    release_year: int | None
    popularity: int | None
    explicit: bool
    duration_ms: int | None


@dataclass(frozen=True)
class PlaylistTrackRecord:
    track_id: str
    position: int
    added_at: str | None


@dataclass
class SyncStats:
    playlists_seen: int = 0
    playlists_synced: int = 0
    playlists_skipped: int = 0
    tracks_upserted: int = 0
    saved_tracks: int = 0
    artists_fetched: int = 0
    skipped_items: int = 0
    errors: list[str] = field(default_factory=list)


class Repository(Protocol):
    def get_playlist_snapshots(self, user_id: str) -> dict[str, str]:
        """Previously stored snapshot_id per playlist spotify_id."""
        ...

    def upsert_playlist(self, user_id: str, playlist: dict[str, Any], is_owned: bool) -> None: ...

    def upsert_tracks(self, tracks: list[TrackRecord]) -> None: ...

    def replace_playlist_tracks(
        self, playlist_id: str, entries: list[PlaylistTrackRecord]
    ) -> None: ...

    def mark_playlist_synced(self, playlist_id: str, snapshot_id: str) -> None: ...

    def replace_saved_tracks(self, user_id: str, entries: list[PlaylistTrackRecord]) -> None: ...

    def known_artist_ids(self) -> set[str]: ...

    def upsert_artists(self, artists: list[dict[str, Any]]) -> None: ...

    def mark_user_synced(self, user_id: str, at: datetime) -> None: ...


def parse_track(raw: dict[str, Any] | None) -> TrackRecord | None:
    """Convert a raw API track object; None for local/unavailable tracks."""
    if not raw or not raw.get("id") or raw.get("is_local"):
        return None
    album = raw.get("album") or {}
    release_date = album.get("release_date") or ""
    year = int(release_date[:4]) if release_date[:4].isdigit() else None
    return TrackRecord(
        spotify_id=raw["id"],
        name=raw.get("name") or "",
        artist_ids=[a["id"] for a in raw.get("artists", []) if a.get("id")],
        album_name=album.get("name"),
        release_year=year,
        popularity=raw.get("popularity"),
        explicit=bool(raw.get("explicit")),
        duration_ms=raw.get("duration_ms"),
    )


def _collect_items(
    items: list[dict[str, Any]], stats: SyncStats
) -> tuple[list[TrackRecord], list[PlaylistTrackRecord]]:
    tracks: list[TrackRecord] = []
    entries: list[PlaylistTrackRecord] = []
    position = 0
    for item in items:
        track = parse_track(item.get("track"))
        if track is None:
            stats.skipped_items += 1
            continue
        tracks.append(track)
        entries.append(
            PlaylistTrackRecord(
                track_id=track.spotify_id,
                position=position,
                added_at=item.get("added_at"),
            )
        )
        position += 1
    return tracks, entries


def run_sync(
    repo: Repository,
    client: SpotifyClient,
    user_id: str,
    user_spotify_id: str,
    now: datetime | None = None,
) -> SyncStats:
    stats = SyncStats()
    touched_artist_ids: set[str] = set()

    # 1 & 2. Playlists and their tracks (incremental via snapshot_id).
    stored_snapshots = repo.get_playlist_snapshots(user_id)
    for playlist in client.get_my_playlists():
        stats.playlists_seen += 1
        playlist_id = playlist["id"]
        is_owned = (playlist.get("owner") or {}).get("id") == user_spotify_id
        repo.upsert_playlist(user_id, playlist, is_owned)

        if stored_snapshots.get(playlist_id) == playlist["snapshot_id"]:
            stats.playlists_skipped += 1
            continue

        items = list(client.get_playlist_tracks(playlist_id))
        tracks, entries = _collect_items(items, stats)
        repo.upsert_tracks(tracks)
        repo.replace_playlist_tracks(playlist_id, entries)
        repo.mark_playlist_synced(playlist_id, playlist["snapshot_id"])
        stats.playlists_synced += 1
        stats.tracks_upserted += len(tracks)
        touched_artist_ids.update(a for t in tracks for a in t.artist_ids)

    # 3. Saved ("liked") tracks — full replace of the set.
    saved_items = list(client.get_saved_tracks())
    saved_tracks, saved_entries = _collect_items(saved_items, stats)
    repo.upsert_tracks(saved_tracks)
    repo.replace_saved_tracks(user_id, saved_entries)
    stats.saved_tracks = len(saved_entries)
    touched_artist_ids.update(a for t in saved_tracks for a in t.artist_ids)

    # 4. Artist genres for anything new.
    missing = sorted(touched_artist_ids - repo.known_artist_ids())
    if missing:
        artists = client.get_artists(missing)
        repo.upsert_artists(artists)
        stats.artists_fetched = len(artists)

    repo.mark_user_synced(user_id, now or datetime.now().astimezone())
    return stats
