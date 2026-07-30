"""Run a library sync for a user.

Usage:
    python -m pigeonhole_worker.run           # sync the only (or first) user
    python -m pigeonhole_worker.run SPOTIFY_ID

Reads DATABASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and
TOKEN_ENCRYPTION_KEY from the environment / worker/.env. Spotify-side access
is read-only; writes go to our Postgres.
"""

from __future__ import annotations

import os
import sys
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from pigeonhole_worker.crypto import decrypt_token, encrypt_token, key_from_env
from pigeonhole_worker.db import connect
from pigeonhole_worker.repo import PostgresRepository
from pigeonhole_worker.spotify import SpotifyClient, refresh_access_token
from pigeonhole_worker.sync import run_sync


def _load_user(conn: psycopg.Connection[Any], spotify_id: str | None) -> tuple[str, str]:
    if spotify_id:
        row = conn.execute(
            "SELECT id, spotify_id FROM users WHERE spotify_id = %s", (spotify_id,)
        ).fetchone()
    else:
        row = conn.execute("SELECT id, spotify_id FROM users ORDER BY created_at").fetchone()
    if row is None:
        raise SystemExit("No matching user. Sign in via the web app first.")
    return str(row[0]), str(row[1])


def _fresh_access_token(conn: psycopg.Connection[Any], user_id: str) -> str:
    key = key_from_env()
    row = conn.execute(
        "SELECT refresh_token_enc FROM spotify_accounts WHERE user_id = %s", (user_id,)
    ).fetchone()
    if row is None:
        raise SystemExit(f"No spotify_account row for user {user_id}.")
    refresh_token = decrypt_token(bytes(row[0]), key)

    client_id = os.environ.get("SPOTIFY_CLIENT_ID")
    client_secret = os.environ.get("SPOTIFY_CLIENT_SECRET")
    if not client_id or not client_secret:
        raise SystemExit("SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET are not set in worker/.env")

    payload = refresh_access_token(client_id, client_secret, refresh_token)
    access_token: str = payload["access_token"]
    expires_at = datetime.now(UTC) + timedelta(seconds=int(payload.get("expires_in", 3600)))
    rotated = payload.get("refresh_token")
    if rotated:
        conn.execute(
            "UPDATE spotify_accounts SET access_token_enc = %s, access_expires_at = %s, "
            "refresh_token_enc = %s WHERE user_id = %s",
            (encrypt_token(access_token, key), expires_at, encrypt_token(rotated, key), user_id),
        )
    else:
        conn.execute(
            "UPDATE spotify_accounts SET access_token_enc = %s, access_expires_at = %s "
            "WHERE user_id = %s",
            (encrypt_token(access_token, key), expires_at, user_id),
        )
    conn.commit()
    return access_token


def main(argv: Sequence[str] | None = None) -> int:
    args = list(argv if argv is not None else sys.argv[1:])
    spotify_id = args[0] if args else None

    conn = connect()
    try:
        user_id, user_spotify_id = _load_user(conn, spotify_id)
        print(f"Syncing library for {user_spotify_id} ({user_id})")
        access_token = _fresh_access_token(conn, user_id)
        stats = run_sync(
            PostgresRepository(conn), SpotifyClient(access_token), user_id, user_spotify_id
        )
        print(
            f"done: {stats.playlists_synced} playlists synced, "
            f"{stats.playlists_skipped} skipped (unchanged), "
            f"{stats.tracks_upserted} tracks upserted, "
            f"{stats.saved_tracks} saved tracks, "
            f"{stats.artists_fetched} artists fetched, "
            f"{stats.skipped_items} local/unavailable items skipped"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
