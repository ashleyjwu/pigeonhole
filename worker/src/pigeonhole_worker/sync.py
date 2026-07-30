"""Library ingestion: pull a user's Spotify library into Postgres.

The algorithm (see spec design, updated for the Feb-2026 API):
  1. Page through the user's playlists; upsert playlist rows.
  2. For each playlist whose ``snapshot_id`` changed since the last sync,
     re-fetch its items and replace the playlist_tracks set. Unchanged
     playlists are skipped entirely.
  3. Replace the user's saved ("liked") tracks set.
  4. Upsert artists from the (id, name) pairs embedded in track objects.
     (Dedicated artist endpoints no longer return genres in dev mode, and the
     batch endpoint is gone — see steering/tech.md.)

Persistence goes through the ``Repository`` protocol so the orchestration is
unit-testable with an in-memory fake; the SQL lives in ``repo.py``. Each
playlist is persisted independently, so an interrupted sync resumes where it
left off (already-synced playlists are skipped by snapshot on the next run).

API shape notes (verified by live probe, 2026-07):
  - Playlist entries come from ``GET /playlists/{id}/items`` with the track
    under the ``item`` key; saved-track entries still use ``track``.
  - Playlist objects carry ``items.total`` (formerly ``tracks.total``).
  - Track objects no longer include ``popularity``; artist objects no longer
    include ``genres``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from pigeonhole_worker.spotify import SpotifyClient, SpotifyError


@dataclass(frozen=True)
class TrackRecord:
    spotify_id: str
    name: str
    artist_ids: list[str]
    artist_names: list[str]
    album_name: str | None
    release_year: int | None
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
    playlists_foreign: int = 0
    tracks_upserted: int = 0
    saved_tracks: int = 0
    artists_upserted: int = 0
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

    def upsert_artists(self, artists: list[dict[str, Any]]) -> None: ...

    def mark_user_synced(self, user_id: str, at: datetime) -> None: ...


def parse_track(raw: dict[str, Any] | None) -> TrackRecord | None:
    """Convert a raw API track object; None for local/unavailable tracks."""
    if not raw or not raw.get("id") or raw.get("is_local"):
        return None
    album = raw.get("album") or {}
    release_date = album.get("release_date") or ""
    year = int(release_date[:4]) if release_date[:4].isdigit() else None
    artists = [a for a in raw.get("artists", []) if a.get("id")]
    return TrackRecord(
        spotify_id=raw["id"],
        name=raw.get("name") or "",
        artist_ids=[a["id"] for a in artists],
        artist_names=[a.get("name") or "" for a in artists],
        album_name=album.get("name"),
        release_year=year,
        explicit=bool(raw.get("explicit")),
        duration_ms=raw.get("duration_ms"),
    )


def _collect_items(
    items: list[dict[str, Any]], stats: SyncStats, track_key: str
) -> tuple[list[TrackRecord], list[PlaylistTrackRecord]]:
    """``track_key`` is "item" for playlist entries, "track" for saved tracks."""
    tracks: list[TrackRecord] = []
    entries: list[PlaylistTrackRecord] = []
    position = 0
    for entry in items:
        if entry.get("is_local"):
            stats.skipped_items += 1
            continue
        track = parse_track(entry.get(track_key))
        if track is None:
            stats.skipped_items += 1
            continue
        tracks.append(track)
        entries.append(
            PlaylistTrackRecord(
                track_id=track.spotify_id,
                position=position,
                added_at=entry.get("added_at"),
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
    touched_artists: dict[str, str] = {}

    def note_artists(tracks: list[TrackRecord]) -> None:
        for track in tracks:
            for artist_id, artist_name in zip(track.artist_ids, track.artist_names, strict=True):
                touched_artists[artist_id] = artist_name

    # 1 & 2. Playlists and their items (incremental via snapshot_id).
    stored_snapshots = repo.get_playlist_snapshots(user_id)
    for playlist in client.get_my_playlists():
        stats.playlists_seen += 1
        playlist_id = playlist["id"]
        is_owned = (playlist.get("owner") or {}).get("id") == user_spotify_id

        # Foreign (followed, non-collaborative) playlists are not ingested at
        # all: they can't be add targets, and dev-mode apps get 403 reading
        # their items anyway.
        if not is_owned and not playlist.get("collaborative"):
            stats.playlists_foreign += 1
            continue

        repo.upsert_playlist(user_id, playlist, is_owned)

        if stored_snapshots.get(playlist_id) == playlist["snapshot_id"]:
            stats.playlists_skipped += 1
            continue

        print(f"  syncing playlist {stats.playlists_seen}: {playlist.get('name')!r}", flush=True)
        try:
            items = list(client.get_playlist_items(playlist_id))
        except SpotifyError as error:
            if error.status == 403:
                # Unreadable despite ownership checks; record and move on.
                stats.errors.append(f"403 reading playlist {playlist_id}")
                continue
            raise
        tracks, entries = _collect_items(items, stats, track_key="item")
        repo.upsert_tracks(tracks)
        repo.replace_playlist_tracks(playlist_id, entries)
        repo.mark_playlist_synced(playlist_id, playlist["snapshot_id"])
        stats.playlists_synced += 1
        stats.tracks_upserted += len(tracks)
        note_artists(tracks)

    # 3. Saved ("liked") tracks — full replace of the set.
    saved_items = list(client.get_saved_tracks())
    saved_tracks, saved_entries = _collect_items(saved_items, stats, track_key="track")
    repo.upsert_tracks(saved_tracks)
    repo.replace_saved_tracks(user_id, saved_entries)
    stats.saved_tracks = len(saved_entries)
    note_artists(saved_tracks)

    # 4. Artists from embedded track data (id + name; genres are gone).
    if touched_artists:
        repo.upsert_artists(
            [{"id": artist_id, "name": name} for artist_id, name in sorted(touched_artists.items())]
        )
        stats.artists_upserted = len(touched_artists)

    repo.mark_user_synced(user_id, now or datetime.now().astimezone())
    return stats
