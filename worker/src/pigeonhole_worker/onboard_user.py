"""Onboard a newly-allowlisted real user, end to end.

After a user is added to the Spotify allowlist and signs in on the web app
(which stores their encrypted tokens), this does the rest in one command:

  1. sync their library (playlists, tracks, saved songs) — sleeping through
     any dev-mode quota window and resuming, like `run --until-complete`;
  2. enrich genre tags for any of their artists not seen before;
  3. recompute playlist profiles so the new genre data feeds suggestions.

Usage:
    python -m pigeonhole_worker.onboard_user --list          # find a spotify_id
    python -m pigeonhole_worker.onboard_user SPOTIFY_ID
    python -m pigeonhole_worker.onboard_user SPOTIFY_ID --skip-genres

Reads the same env as the worker (DATABASE_URL, SPOTIFY_CLIENT_ID/SECRET,
TOKEN_ENCRYPTION_KEY, LASTFM_API_KEY). The TOKEN_ENCRYPTION_KEY must match
the web app's, or the stored tokens can't be decrypted.
"""

from __future__ import annotations

import argparse
import os
import sys
from collections.abc import Callable, Sequence

from pigeonhole_worker.db import connect
from pigeonhole_worker.enrich_genres import EnrichStats, enrich_genres
from pigeonhole_worker.lastfm import LastFmClient
from pigeonhole_worker.profiles import compute_all
from pigeonhole_worker.repo import PostgresRepository
from pigeonhole_worker.run import run_until_complete, sync_once

ENRICH_BATCH = 200
# Ceiling so a run can't spin forever if artists keep erroring (their
# genre_fetched_at stays unset, so they'd otherwise be retried endlessly).
MAX_ENRICH_ROUNDS = 100


def list_users() -> int:
    """Print non-demo users so the operator can find a spotify_id to onboard."""
    conn = connect()
    try:
        rows = conn.execute(
            "SELECT spotify_id, display_name, email, last_synced_at "
            "FROM users WHERE NOT is_demo ORDER BY created_at DESC"
        ).fetchall()
    finally:
        conn.close()
    if not rows:
        print("No real (non-demo) users yet. Have them sign in on the web app first.")
        return 0
    print(f"{'spotify_id':<28} {'display_name':<22} {'email':<28} last synced")
    for spotify_id, name, email, synced in rows:
        print(f"{spotify_id or '':<28} {name or '':<22} {email or '':<28} {synced or 'never'}")
    return 0


def drain_genre_enrichment(
    enrich_once: Callable[[], EnrichStats], max_rounds: int = MAX_ENRICH_ROUNDS
) -> int:
    """Call `enrich_once` until no artist needs tags. Returns the number of
    artists successfully resolved (tagged or confirmed tagless).

    Stops when a round attempts nothing (queue drained) or makes no
    successful progress (only errors that round), so a persistent Last.fm
    failure can't loop forever.
    """
    resolved = 0
    for _ in range(max_rounds):
        stats = enrich_once()
        if stats.attempted == 0:
            break
        progressed = stats.tagged + stats.no_tags
        resolved += progressed
        if progressed == 0:
            break  # only errors this round — don't spin
    return resolved


def enrich_new_artists() -> None:
    api_key = os.environ.get("LASTFM_API_KEY")
    if not api_key:
        print("  LASTFM_API_KEY not set — skipping genre enrichment.")
        return
    conn = connect()
    try:
        repo = PostgresRepository(conn)
        client = LastFmClient(api_key)
        resolved = drain_genre_enrichment(
            lambda: enrich_genres(repo, client, limit=ENRICH_BATCH)
        )
        print(f"  enriched {resolved} artists")
    finally:
        conn.close()


def recompute_profiles() -> None:
    conn = connect()
    try:
        count = compute_all(conn)
        print(f"  recomputed profiles for {count} playlists")
    finally:
        conn.close()


def onboard(spotify_id: str, skip_genres: bool = False) -> None:
    print(f"[1/3] syncing library for {spotify_id} ...")
    run_until_complete(lambda: sync_once(spotify_id))

    if skip_genres:
        print("[2/3] skipping genre enrichment (--skip-genres)")
        print("[3/3] profiles already recomputed by the sync")
        print("done — user is ready.")
        return

    print("[2/3] enriching genres for new artists ...")
    enrich_new_artists()
    print("[3/3] recomputing profiles with the new genre data ...")
    recompute_profiles()
    print("done — user is ready.")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Onboard a real user (sync + genres + profiles).")
    parser.add_argument("spotify_id", nargs="?", default=None)
    parser.add_argument("--list", action="store_true", help="List users to find a spotify_id.")
    parser.add_argument(
        "--skip-genres",
        action="store_true",
        help="Skip Last.fm genre enrichment (sync + profiles only).",
    )
    args = parser.parse_args(argv)

    if args.list:
        return list_users()
    if not args.spotify_id:
        parser.error("provide a SPOTIFY_ID, or use --list to find one")
    onboard(args.spotify_id, skip_genres=args.skip_genres)
    return 0


if __name__ == "__main__":
    sys.exit(main())
