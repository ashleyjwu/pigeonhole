"""Enrich artists with genre tags from Last.fm.

A separate batch job from the Spotify sync — different API, different rate
limit, and it should never compete with the Spotify quota. Only artists never
enriched (genre_fetched_at IS NULL) are fetched, so re-runs are cheap; an
artist with genuinely no Last.fm tags is still marked fetched (empty tags)
so it is not retried every run.

Usage:
    python -m pigeonhole_worker.enrich_genres [--limit N]
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol

from pigeonhole_worker.genre_tags import normalize_tags
from pigeonhole_worker.lastfm import LastFmClient, LastFmError

DEFAULT_LIMIT = 200


class GenreRepository(Protocol):
    def artists_needing_genre_tags(self, limit: int) -> list[tuple[str, str]]: ...

    def store_genre_tags(self, artist_id: str, tags: dict[str, float]) -> None: ...


class TagSource(Protocol):
    def get_artist_top_tags(self, artist_name: str) -> list[tuple[str, int]]: ...


@dataclass
class EnrichStats:
    attempted: int = 0
    tagged: int = 0
    no_tags: int = 0
    errors: int = 0


def enrich_genres(
    repo: GenreRepository, source: TagSource, limit: int = DEFAULT_LIMIT
) -> EnrichStats:
    stats = EnrichStats()
    for artist_id, name in repo.artists_needing_genre_tags(limit):
        stats.attempted += 1
        try:
            raw_tags = source.get_artist_top_tags(name)
        except LastFmError as error:
            # Leave genre_fetched_at unset so a transient failure gets
            # retried on the next run rather than being treated as "no tags".
            stats.errors += 1
            print(f"  error enriching {name!r}: {error}")
            continue

        tags = normalize_tags(raw_tags)
        repo.store_genre_tags(artist_id, tags)
        if tags:
            stats.tagged += 1
        else:
            stats.no_tags += 1
    return stats


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Enrich artists with Last.fm genre tags.")
    parser.add_argument("--limit", type=int, default=DEFAULT_LIMIT)
    args = parser.parse_args(argv)

    import os

    from pigeonhole_worker.db import connect
    from pigeonhole_worker.repo import PostgresRepository

    # connect() loads worker/.env as a side effect (see db.py: database_url())
    # before opening the connection, so LASTFM_API_KEY is only guaranteed to
    # be populated after this call — check it afterwards, not before.
    conn = connect()
    api_key = os.environ.get("LASTFM_API_KEY")
    if not api_key:
        conn.close()
        raise SystemExit(
            "LASTFM_API_KEY is not set. Get a free key at "
            "https://www.last.fm/api/account/create and add it to worker/.env"
        )
    try:
        stats = enrich_genres(PostgresRepository(conn), LastFmClient(api_key), args.limit)
        print(
            f"attempted {stats.attempted}: {stats.tagged} tagged, "
            f"{stats.no_tags} had no tags, {stats.errors} errors"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
