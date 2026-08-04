"""Run a library sync for a user.

Usage:
    python -m pigeonhole_worker.run                    # one attempt
    python -m pigeonhole_worker.run --until-complete   # retry across quota resets
    python -m pigeonhole_worker.run SPOTIFY_ID

With --until-complete, a QuotaExhaustedError makes the runner sleep for the
exact Retry-After Spotify sent (plus a buffer) and try again, resuming where
the previous attempt left off, until a full sync completes.

Reads DATABASE_URL, SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and
TOKEN_ENCRYPTION_KEY from the environment / worker/.env. Spotify-side access
is read-only; writes go to our Postgres.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from collections.abc import Callable, Sequence
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from pigeonhole_worker.crypto import decrypt_token, encrypt_token, key_from_env
from pigeonhole_worker.db import connect
from pigeonhole_worker.profiles import compute_all
from pigeonhole_worker.repo import PostgresRepository
from pigeonhole_worker.spotify import QuotaExhaustedError, SpotifyClient, refresh_access_token
from pigeonhole_worker.sync import SyncStats, run_sync

# Extra wait beyond Spotify's Retry-After, so we never retry a hair early.
QUOTA_BUFFER_SECONDS = 120.0
MAX_QUOTA_RETRIES = 14  # ~2 weeks of daily windows, a generous ceiling


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


def should_recompute_profiles(stats: SyncStats) -> bool:
    """Profiles only depend on playlist_tracks contents, so recomputation is
    only worth its cost when at least one playlist's tracks actually changed
    this run (skips the no-op case where every playlist was unchanged)."""
    return stats.playlists_synced > 0


def sync_once(spotify_id: str | None, force: bool = False) -> SyncStats:
    """One sync attempt. Raises QuotaExhaustedError if the quota is spent."""
    conn = connect()
    try:
        user_id, user_spotify_id = _load_user(conn, spotify_id)
        print(f"[{datetime.now(UTC):%Y-%m-%d %H:%M:%S}] Syncing library for {user_spotify_id}")
        access_token = _fresh_access_token(conn, user_id)
        stats = run_sync(
            PostgresRepository(conn),
            SpotifyClient(access_token),
            user_id,
            user_spotify_id,
            force=force,
        )
        print(
            f"done: {stats.playlists_synced} playlists synced, "
            f"{stats.playlists_skipped} skipped (unchanged), "
            f"{stats.playlists_foreign} foreign (followed, not owned), "
            f"{stats.playlists_deleted} deleted (no longer on Spotify), "
            f"{stats.tracks_upserted} tracks upserted, "
            f"{stats.saved_tracks} saved tracks, "
            f"{stats.artists_upserted} artists upserted, "
            f"{stats.skipped_items} local/unavailable items skipped"
        )
        if stats.errors:
            print(f"errors ({len(stats.errors)}):")
            for line in stats.errors[:10]:
                print(f"  {line}")

        # Keep playlist_profiles in sync with what was just ingested — the
        # scorer only sees playlists that have a profile row, so a sync
        # without this step leaves newly-synced playlists invisible to
        # suggestions (a real bug we hit: 231 playlists synced, 10 stale
        # profiles left over from before the backfill).
        if should_recompute_profiles(stats):
            profile_count = compute_all(conn)
            print(f"recomputed profiles for {profile_count} playlists")
        return stats
    finally:
        conn.close()


def run_until_complete(
    attempt: Callable[[], SyncStats],
    sleep: Callable[[float], None] = time.sleep,
    max_retries: int = MAX_QUOTA_RETRIES,
) -> SyncStats:
    """Run ``attempt`` until it completes, sleeping through quota exhaustion.

    Each retry resumes where the last stopped (synced playlists are skipped by
    snapshot), so total progress is monotonic across attempts.
    """
    for retry in range(max_retries + 1):
        try:
            return attempt()
        except QuotaExhaustedError as error:
            if retry == max_retries:
                raise
            wait = error.retry_after + QUOTA_BUFFER_SECONDS
            resume_at = datetime.now(UTC) + timedelta(seconds=wait)
            print(
                f"[{datetime.now(UTC):%Y-%m-%d %H:%M:%S}] quota exhausted; "
                f"sleeping {wait / 3600:.1f}h, resuming ~{resume_at:%Y-%m-%d %H:%M} UTC "
                f"(attempt {retry + 1}/{max_retries})",
                flush=True,
            )
            sleep(wait)
    raise AssertionError("unreachable")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync a user's Spotify library.")
    parser.add_argument("spotify_id", nargs="?", default=None)
    parser.add_argument(
        "--until-complete",
        action="store_true",
        help="Keep retrying across quota resets until a full sync completes.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help=(
            "Re-fetch every playlist's items regardless of snapshot_id. "
            "Much heavier than a normal incremental sync — use only to "
            "backfill a track/playlist field that didn't exist in earlier "
            "syncs."
        ),
    )
    args = parser.parse_args(argv)

    if args.until_complete:
        run_until_complete(lambda: sync_once(args.spotify_id, force=args.force))
    else:
        sync_once(args.spotify_id, force=args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
