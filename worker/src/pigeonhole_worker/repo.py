"""Postgres implementation of the sync Repository protocol."""

from __future__ import annotations

from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from pigeonhole_worker.sync import PlaylistTrackRecord, TrackRecord, parse_playlist_image_url


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
                (spotify_id, owner_user_id, name, description, image_url, snapshot_id,
                 track_count, is_owned, collaborative)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (spotify_id) DO UPDATE SET
                name = EXCLUDED.name,
                description = EXCLUDED.description,
                image_url = EXCLUDED.image_url,
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
                parse_playlist_image_url(playlist),
                playlist["snapshot_id"],
                (playlist.get("tracks") or {}).get("total", 0),
                is_owned,
                bool(playlist.get("collaborative")),
            ),
        )
        self._conn.commit()

    def upsert_tracks(self, tracks: list[TrackRecord]) -> None:
        # `popularity` stays NULL: the field was removed from the API for
        # dev-mode apps in Feb 2026.
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO tracks
                    (spotify_id, name, artist_ids, album_name, release_year,
                     explicit, duration_ms)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (spotify_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    artist_ids = EXCLUDED.artist_ids,
                    album_name = EXCLUDED.album_name,
                    release_year = EXCLUDED.release_year,
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
                        t.explicit,
                        t.duration_ms,
                    )
                    for t in tracks
                ],
            )
        self._conn.commit()

    def replace_playlist_tracks(self, playlist_id: str, entries: list[PlaylistTrackRecord]) -> None:
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

    def upsert_artists(self, artists: list[dict[str, Any]]) -> None:
        # Only id + name are available from embedded track data; the API's
        # genres/popularity fields were removed for dev-mode apps in Feb 2026.
        with self._conn.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO artists (spotify_id, name, fetched_at)
                VALUES (%s, %s, now())
                ON CONFLICT (spotify_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    fetched_at = now()
                """,
                [(a["id"], a.get("name") or "") for a in artists],
            )
        self._conn.commit()

    def delete_playlists(self, playlist_ids: list[str]) -> None:
        if not playlist_ids:
            return
        self._conn.execute(
            "DELETE FROM playlists WHERE spotify_id = ANY(%s)",
            (playlist_ids,),
        )
        self._conn.commit()

    def mark_user_synced(self, user_id: str, at: datetime) -> None:
        self._conn.execute(
            "UPDATE users SET last_synced_at = %s WHERE id = %s",
            (at, user_id),
        )
        self._conn.commit()

    def artists_needing_genre_tags(self, limit: int) -> list[tuple[str, str]]:
        """(spotify_id, name) for artists never enriched, oldest name first."""
        rows = self._conn.execute(
            """
            SELECT spotify_id, name FROM artists
            WHERE genre_fetched_at IS NULL AND name <> ''
            ORDER BY spotify_id
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
        return [(row[0], row[1]) for row in rows]

    def store_genre_tags(self, artist_id: str, tags: dict[str, float]) -> None:
        self._conn.execute(
            """
            UPDATE artists SET genre_tags = %s, genre_fetched_at = now()
            WHERE spotify_id = %s
            """,
            (Jsonb(tags) if tags else Jsonb({}), artist_id),
        )
        self._conn.commit()
