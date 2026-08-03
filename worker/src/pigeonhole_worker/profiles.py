"""Compute playlist profiles for content-based scoring.

A profile summarizes a playlist using the data still available under the
Feb-2026 API: per-artist prominence (fraction of the playlist's tracks that
feature each artist), the release-year (era) distribution, a recency signal
derived from playlist_tracks.added_at (Spotify exposes no playlist creation
date at all, so this is the best available proxy — see
migrations/0005_profile_recency.sql), and a genre-tag distribution sourced
from Last.fm (Spotify removed artist genres for dev-mode apps — see
lastfm.py / enrich_genres.py). Popularity is gone entirely and is not part
of the profile.

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
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import psycopg
from psycopg.types.json import Jsonb

from pigeonhole_worker.db import connect

# A track object contributes: its artist ids, its release year-or-None, when
# it was added to the playlist-or-None, and its artists' merged genre tags
# (tag_name -> weight, already normalized per artist by genre_tags.py).
TrackFacts = tuple[list[str], int | None, datetime | None, list[Mapping[str, float]]]


@dataclass(frozen=True)
class PlaylistProfile:
    playlist_id: str
    track_count: int
    artist_weights: dict[str, float]  # artist_id -> fraction of tracks featuring it
    era_mean: float | None
    era_std: float | None
    era_count: int
    oldest_track_added_at: datetime | None  # proxy for "playlist created"
    newest_track_added_at: datetime | None  # exact "playlist last updated"
    genre_dist: dict[str, float]  # tag_name -> normalized weight across the playlist


def _merge_genre_dist(tag_maps: list[Mapping[str, float]]) -> dict[str, float]:
    """Sum per-track tag weights across a playlist, normalize to the top tag.

    A track contributes the merged tags of ALL its artists (a feature can
    have several artists, each with their own Last.fm tags); tracks with no
    tag data simply contribute nothing.
    """
    totals: dict[str, float] = {}
    for tags in tag_maps:
        for tag, weight in tags.items():
            totals[tag] = totals.get(tag, 0.0) + weight
    if not totals:
        return {}
    top = max(totals.values())
    return {tag: value / top for tag, value in totals.items()}


def build_profile(playlist_id: str, tracks: Sequence[TrackFacts]) -> PlaylistProfile:
    """Summarize a playlist from its tracks. Pure; no I/O."""
    track_count = len(tracks)
    artist_track_counts: Counter[str] = Counter()
    years: list[int] = []
    added_ats: list[datetime] = []
    track_genre_maps: list[Mapping[str, float]] = []
    for artist_ids, year, added_at, artist_tag_maps in tracks:
        for artist_id in set(artist_ids):  # a track counts once per distinct artist
            artist_track_counts[artist_id] += 1
        if year is not None:
            years.append(year)
        if added_at is not None:
            added_ats.append(added_at)
        # Merge this track's artists' tags into one per-track tag map so a
        # multi-artist track doesn't get double-counted per artist below.
        track_tags: dict[str, float] = {}
        for artist_tags in artist_tag_maps:
            for tag, weight in artist_tags.items():
                track_tags[tag] = max(track_tags.get(tag, 0.0), weight)
        if track_tags:
            track_genre_maps.append(track_tags)

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
        oldest_track_added_at=min(added_ats) if added_ats else None,
        newest_track_added_at=max(added_ats) if added_ats else None,
        genre_dist=_merge_genre_dist(track_genre_maps),
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
            (playlist_id, artist_weights, artist_set, era_stats,
             oldest_track_added_at, newest_track_added_at, genre_dist, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, now())
        ON CONFLICT (playlist_id) DO UPDATE SET
            artist_weights = EXCLUDED.artist_weights,
            artist_set = EXCLUDED.artist_set,
            era_stats = EXCLUDED.era_stats,
            oldest_track_added_at = EXCLUDED.oldest_track_added_at,
            newest_track_added_at = EXCLUDED.newest_track_added_at,
            genre_dist = EXCLUDED.genre_dist,
            updated_at = now()
        """,
        (
            profile.playlist_id,
            Jsonb(profile.artist_weights),
            list(profile.artist_weights.keys()),
            Jsonb(era_stats) if era_stats is not None else None,
            profile.oldest_track_added_at,
            profile.newest_track_added_at,
            Jsonb(profile.genre_dist),
        ),
    )
    conn.commit()


def compute_all(conn: psycopg.Connection[Any]) -> int:
    """(Re)compute and store a profile for every stored playlist."""
    playlist_ids = [row[0] for row in conn.execute("SELECT spotify_id FROM playlists").fetchall()]
    for playlist_id in playlist_ids:
        rows = conn.execute(
            """
            SELECT t.artist_ids, t.release_year, pt.added_at,
                   coalesce(
                       array_agg(a.genre_tags) FILTER (WHERE a.genre_tags IS NOT NULL),
                       '{}'
                   ) AS artist_tag_maps
            FROM playlist_tracks pt
            JOIN tracks t ON t.spotify_id = pt.track_id
            LEFT JOIN artists a ON a.spotify_id = ANY(t.artist_ids)
            WHERE pt.playlist_id = %s
            GROUP BY t.spotify_id, t.artist_ids, t.release_year, pt.added_at
            """,
            (playlist_id,),
        ).fetchall()
        tracks: list[TrackFacts] = [(row[0], row[1], row[2], row[3] or []) for row in rows]
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
