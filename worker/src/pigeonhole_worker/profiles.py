"""Compute playlist profiles for content-based scoring.

A profile summarizes a playlist using the data still available under the
Feb-2026 API: per-artist prominence (fraction of the playlist's tracks that
feature each artist) and the release-year (era) distribution. Genres and
popularity are gone, so they are not part of the profile.

Profiles are written to the ``playlist_profiles`` table and consumed by the
web scorer (``web/lib/scoring``). The pure ``build_profile`` is unit-tested;
the DB read/write is a thin wrapper.

Usage:
    python -m pigeonhole_worker.profiles
"""

from __future__ import annotations

import statistics
import sys
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from pigeonhole_worker.db import connect

# A track object contributes (its artist ids, its release year-or-None).
TrackFacts = tuple[list[str], int | None]


@dataclass(frozen=True)
class PlaylistProfile:
    playlist_id: str
    track_count: int
    artist_weights: dict[str, float]  # artist_id -> fraction of tracks featuring it
    era_mean: float | None
    era_std: float | None
    era_count: int


def build_profile(playlist_id: str, tracks: Sequence[TrackFacts]) -> PlaylistProfile:
    """Summarize a playlist from its tracks. Pure; no I/O."""
    track_count = len(tracks)
    artist_track_counts: Counter[str] = Counter()
    years: list[int] = []
    for artist_ids, year in tracks:
        for artist_id in set(artist_ids):  # a track counts once per distinct artist
            artist_track_counts[artist_id] += 1
        if year is not None:
            years.append(year)

    weights = {a: c / track_count for a, c in artist_track_counts.items()} if track_count else {}
    era_mean = statistics.fmean(years) if years else None
    if len(years) >= 2:
        era_std: float | None = statistics.pstdev(years)
    elif years:
        era_std = 0.0
    else:
        era_std = None

    return PlaylistProfile(
        playlist_id=playlist_id,
        track_count=track_count,
        artist_weights=weights,
        era_mean=era_mean,
        era_std=era_std,
        era_count=len(years),
    )


def store_profile(conn: psycopg.Connection[Any], profile: PlaylistProfile) -> None:
    era_stats = (
        {"mean": profile.era_mean, "std": profile.era_std, "count": profile.era_count}
        if profile.era_count
        else None
    )
    conn.execute(
        """
        INSERT INTO playlist_profiles
            (playlist_id, artist_weights, artist_set, era_stats, updated_at)
        VALUES (%s, %s, %s, %s, now())
        ON CONFLICT (playlist_id) DO UPDATE SET
            artist_weights = EXCLUDED.artist_weights,
            artist_set = EXCLUDED.artist_set,
            era_stats = EXCLUDED.era_stats,
            updated_at = now()
        """,
        (
            profile.playlist_id,
            Jsonb(profile.artist_weights),
            list(profile.artist_weights.keys()),
            Jsonb(era_stats) if era_stats is not None else None,
        ),
    )
    conn.commit()


def compute_all(conn: psycopg.Connection[Any]) -> int:
    """(Re)compute and store a profile for every stored playlist."""
    playlist_ids = [row[0] for row in conn.execute("SELECT spotify_id FROM playlists").fetchall()]
    for playlist_id in playlist_ids:
        rows = conn.execute(
            """
            SELECT t.artist_ids, t.release_year
            FROM playlist_tracks pt
            JOIN tracks t ON t.spotify_id = pt.track_id
            WHERE pt.playlist_id = %s
            """,
            (playlist_id,),
        ).fetchall()
        tracks: list[TrackFacts] = [(row[0], row[1]) for row in rows]
        store_profile(conn, build_profile(playlist_id, tracks))
    return len(playlist_ids)


def main() -> int:
    conn = connect()
    try:
        count = compute_all(conn)
        print(f"computed profiles for {count} playlists")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
