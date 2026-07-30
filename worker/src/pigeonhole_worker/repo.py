"""Postgres implementation of the sync Repository protocol."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg

from pigeonhole_worker.sync import PlaylistTrackRecord, TrackRecord


class PostgresRepository:
    """Each method commits its own transaction so an interrupted sync keeps
    completed work (resume skips re-synced playlists via snapshot_id)."""

    def __init__(self, conn: psycopg.Connection[Any]) -> None:
        self._conn = conn

    def get_playlist_snapshots(self, user_id: str) -> dict[str, str]:
        rows = self._conn.execute(
            "SELECT spotify_id, snapshot_id FROM playlists WHERE owner_user_id = %s",
            (user_id,),
        ).fetchall()
        return {row[0]: row[1] for row in rows}

    def upsert_playlist(self, user_id: str, playlist: dict[str, Any], is_owned: bool) -> None:
        self._conn.execute(
            """
            INSERT INTO playlists
                (spotify_id, owner_user_id, name, description, snapshot_id,
                 track_count, is_owned, collaborative)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (spotify_id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                snapshot_id = EXCLUDED.snapshot_id,
                track_count = EXCLUDED.track_count,
                is_owned = EXCLUDED.is_owned,
                collaborative = EXCLUDED.collaborative
            """,
            (
                playlist["id"],
                user_id,
                playlist.get("name") or "",
                playlist.get("description"),
                playlist["snapshot_id"],
                (playlist.get("tracks") or {}).get("total", 0),
                is_owned,
                bool(playlist.get("collaborative")),
            ),
        )
        self._conn.commit()

    def upsert_tracks(self, tracks: list[TrackRecord]) -> None:
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO tracks
                    (spotify_id, name, artist_ids, album_name, release_year,
                     popularity, explicit, duration_ms)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (spotify_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    artist_ids = EXCLUDED.artist_ids,
                    album_name = EXCLUDED.album_name,
                    release_year = EXCLUDED.release_year,
                    popularity = EXCLUDED.popularity,
                    explicit = EXCLUDED.explicit,
                    duration_ms = EXCLUDED.duration_ms
                """,
                [
                    (
                        t.spotify_id,
                        t.name,
                        t.artist_ids,
                        t.album_name,
                        t.release_year,
                        t.popularity,
                        t.explicit,
                        t.duration_ms,
                    )
                    for t in tracks
                ],
            )
        self._conn.commit()

    def replace_playlist_tracks(
        self, playlist_id: str, entries: list[PlaylistTrackRecord]
    ) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM playlist_tracks WHERE playlist_id = %s", (playlist_id,))
            cur.executemany(
                """
                INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (playlist_id, track_id) DO NOTHING
                """,
                [(playlist_id, e.track_id, e.position, e.added_at) for e in entries],
            )
        self._conn.commit()

    def mark_playlist_synced(self, playlist_id: str, snapshot_id: str) -> None:
        self._conn.execute(
            "UPDATE playlists SET snapshot_id = %s, last_synced_at = now() WHERE spotify_id = %s",
            (snapshot_id, playlist_id),
        )
        self._conn.commit()

    def replace_saved_tracks(self, user_id: str, entries: list[PlaylistTrackRecord]) -> None:
        with self._conn.cursor() as cur:
            cur.execute("DELETE FROM saved_tracks WHERE user_id = %s", (user_id,))
            cur.executemany(
                """
                INSERT INTO saved_tracks (user_id, track_id, added_at)
                VALUES (%s, %s, %s)
                ON CONFLICT (user_id, track_id) DO NOTHING
                """,
                [(user_id, e.track_id, e.added_at) for e in entries],
            )
        self._conn.commit()

    def known_artist_ids(self) -> set[str]:
        rows = self._conn.execute("SELECT spotify_id FROM artists").fetchall()
        return {row[0] for row in rows}

    def upsert_artists(self, artists: list[dict[str, Any]]) -> None:
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO artists (spotify_id, name, genres, popularity, fetched_at)
                VALUES (%s, %s, %s, %s, now())
                ON CONFLICT (spotify_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    genres = EXCLUDED.genres,
                    popularity = EXCLUDED.popularity,
                    fetched_at = now()
                """,
                [
                    (
                        a["id"],
                        a.get("name") or "",
                        a.get("genres") or [],
                        a.get("popularity"),
                    )
                    for a in artists
                ],
            )
        self._conn.commit()

    def mark_user_synced(self, user_id: str, at: datetime) -> None:
        self._conn.execute(
            "UPDATE users SET last_synced_at = %s WHERE id = %s",
            (at, user_id),
        )
        self._conn.commit()
