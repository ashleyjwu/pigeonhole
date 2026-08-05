"""Seed the public demo user's data.

The public demo reuses the owner's REAL liked songs (real tracks, artists,
and Last.fm genre tags — so recommendation quality is genuine) but never
exposes real playlists: it clusters those liked songs into fabricated,
whimsically-named playlists owned by a separate demo user. A held-out slice
of songs is left unfiled so the "Sort likes" batch flow has real cards to
review, each getting real suggestions pointing at the fake playlists.

Clustering is intentionally dependency-free (no numpy/sklearn): tracks are
grouped by their primary Last.fm genre tag — the richest available signal,
already enriched — with oversized genres split by decade. This also makes
playlists human-legible and easy to name after their actual contents.

Idempotent: re-running rebuilds the demo user's playlists and saved tracks
from scratch (real tracks/artists are shared and untouched).

Usage:
    python -m pigeonhole_worker.seed_demo
"""

from __future__ import annotations

import random
import sys
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import psycopg

from pigeonhole_worker.db import connect
from pigeonhole_worker.profiles import PlaylistProfile, build_profile, store_profile

DEMO_SPOTIFY_ID = "pigeonhole-demo"
DEMO_DISPLAY_NAME = "Demo Listener"

MIN_PLAYLIST_SIZE = 8
MAX_PLAYLIST_SIZE = 60
# Fraction of each playlist's tracks held back (liked but unfiled) so the
# batch "Sort likes" flow has real songs to review.
HELD_OUT_FRACTION = 0.15
SEED = 20260805

# Whimsical, content-reflective name components (e.g. "hazy 2010s indie
# rock"). Chosen deterministically per playlist so re-runs are stable.
MOODS = (
    "whimsical",
    "hazy",
    "golden-hour",
    "midnight",
    "rainy-day",
    "sun-soaked",
    "velvet",
    "neon-lit",
    "wistful",
    "dreamy",
    "restless",
    "cozy",
    "electric",
    "moonlit",
    "sunday-morning",
    "after-hours",
    "half-asleep",
    "technicolor",
    "slow-burning",
    "featherlight",
)


@dataclass(frozen=True)
class DemoTrack:
    track_id: str
    artist_ids: list[str]
    release_year: int | None
    tags: Mapping[str, float]  # merged genre tags (tag -> weight)


@dataclass(frozen=True)
class DemoPlaylist:
    name: str
    description: str
    genre: str
    decade: int | None
    track_ids: list[str]


def merge_track_tags(artist_tag_maps: Sequence[Mapping[str, float]]) -> dict[str, float]:
    """Merge a track's artists' tag maps by max weight per tag — matches
    profiles.py so a multi-artist track isn't double-counted."""
    merged: dict[str, float] = {}
    for tags in artist_tag_maps:
        for tag, weight in tags.items():
            merged[tag] = max(merged.get(tag, 0.0), weight)
    return merged


def primary_genre(tags: Mapping[str, float]) -> str | None:
    """The track's dominant genre tag, or None when it has no tag data.
    Ties broken alphabetically for determinism."""
    if not tags:
        return None
    return max(sorted(tags), key=lambda t: tags[t])


def decade_of(year: int | None) -> int | None:
    return (year // 10) * 10 if year is not None else None


def _stable_index(key: str, n: int) -> int:
    """A salt-free stable hash -> [0, n). Python's built-in hash() is
    randomized per process, which would make names change between runs."""
    h = 0
    for ch in key:
        h = (h * 31 + ord(ch)) % 1_000_000_007
    return h % n


def playlist_name(genre: str, decade: int | None) -> str:
    mood = MOODS[_stable_index(f"{genre}|{decade}", len(MOODS))]
    return f"{mood} {decade}s {genre}" if decade is not None else f"{mood} {genre}"


def playlist_description(genre: str, count: int) -> str:
    return f"a little pocket of {genre} — {count} songs that seem to belong together"


def _make_playlist(genre: str, decade: int | None, tracks: list[DemoTrack]) -> DemoPlaylist:
    return DemoPlaylist(
        name=playlist_name(genre, decade),
        description=playlist_description(genre, len(tracks)),
        genre=genre,
        decade=decade,
        track_ids=[t.track_id for t in tracks],
    )


def cluster_tracks(
    tracks: Sequence[DemoTrack],
    *,
    min_size: int = MIN_PLAYLIST_SIZE,
    max_size: int = MAX_PLAYLIST_SIZE,
) -> tuple[list[DemoPlaylist], list[str]]:
    """Group tracks into fabricated playlists by primary genre, splitting
    oversized genres by decade. Returns (playlists, leftover_track_ids) —
    leftovers are tracks with no genre or in too-small groups; they become
    unfiled liked songs.
    """
    by_genre: dict[str, list[DemoTrack]] = defaultdict(list)
    leftover: list[str] = []
    for track in tracks:
        genre = primary_genre(track.tags)
        if genre is None:
            leftover.append(track.track_id)
        else:
            by_genre[genre].append(track)

    playlists: list[DemoPlaylist] = []
    for genre in sorted(by_genre):
        group = by_genre[genre]
        if len(group) < min_size:
            leftover.extend(t.track_id for t in group)
            continue
        if len(group) <= max_size:
            playlists.append(_make_playlist(genre, None, group))
            continue

        # Oversized: split by decade. Decades meeting min_size become their
        # own playlist; everything else falls through to leftovers.
        by_decade: dict[int | None, list[DemoTrack]] = defaultdict(list)
        for track in group:
            by_decade[decade_of(track.release_year)].append(track)
        made_any = False
        for decade in sorted(d for d in by_decade if d is not None):
            sub = by_decade[decade]
            if len(sub) >= min_size:
                playlists.append(_make_playlist(genre, decade, sub))
                made_any = True
            else:
                leftover.extend(t.track_id for t in sub)
        leftover.extend(t.track_id for t in by_decade.get(None, []))
        # If no decade was big enough, keep the genre together rather than
        # dumping the whole (large) group into leftovers.
        if not made_any:
            playlists.append(_make_playlist(genre, None, group))
            # undo the leftover additions we just made for this genre
            group_ids = {t.track_id for t in group}
            leftover = [tid for tid in leftover if tid not in group_ids]

    return playlists, leftover


def split_held_out(
    track_ids: Sequence[str], fraction: float, rng: random.Random
) -> tuple[list[str], list[str]]:
    """Partition a playlist's tracks into (placed, held_out). Held-out songs
    stay liked but unfiled so the batch flow has cards; every playlist keeps
    at least min_size - a couple placed so its profile stays meaningful."""
    ids = list(track_ids)
    rng.shuffle(ids)
    n_held = int(len(ids) * fraction)
    held = ids[:n_held]
    placed = ids[n_held:]
    return placed, held


# ── DB layer (thin) ────────────────────────────────────────────────────


def get_or_create_demo_user(conn: psycopg.Connection[Any]) -> str:
    row = conn.execute(
        "SELECT id FROM users WHERE spotify_id = %s", (DEMO_SPOTIFY_ID,)
    ).fetchone()
    if row is not None:
        return str(row[0])
    inserted = conn.execute(
        "INSERT INTO users (spotify_id, display_name, is_demo) VALUES (%s, %s, true) RETURNING id",
        (DEMO_SPOTIFY_ID, DEMO_DISPLAY_NAME),
    ).fetchone()
    conn.commit()
    assert inserted is not None
    return str(inserted[0])


def find_owner_user_id(conn: psycopg.Connection[Any]) -> str:
    row = conn.execute(
        "SELECT id FROM users WHERE NOT is_demo ORDER BY created_at LIMIT 1"
    ).fetchone()
    if row is None:
        raise SystemExit("No real (non-demo) user found to source liked songs from.")
    return str(row[0])


def load_owner_liked_songs(conn: psycopg.Connection[Any], owner_user_id: str) -> list[DemoTrack]:
    rows = conn.execute(
        """
        SELECT t.spotify_id, t.artist_ids, t.release_year,
               coalesce(
                   array_agg(a.genre_tags) FILTER (WHERE a.genre_tags IS NOT NULL),
                   '{}'
               ) AS tag_maps
        FROM saved_tracks st
        JOIN tracks t ON t.spotify_id = st.track_id
        LEFT JOIN artists a ON a.spotify_id = ANY(t.artist_ids)
        WHERE st.user_id = %s
        GROUP BY t.spotify_id, t.artist_ids, t.release_year
        """,
        (owner_user_id,),
    ).fetchall()
    tracks: list[DemoTrack] = []
    for spotify_id, artist_ids, release_year, tag_maps in rows:
        tracks.append(
            DemoTrack(
                track_id=spotify_id,
                artist_ids=list(artist_ids or []),
                release_year=release_year,
                tags=merge_track_tags(tag_maps or []),
            )
        )
    return tracks


def _reset_demo_data(conn: psycopg.Connection[Any], demo_user_id: str) -> None:
    # Cascades to playlist_tracks and playlist_profiles via FK constraints.
    conn.execute("DELETE FROM playlists WHERE owner_user_id = %s", (demo_user_id,))
    conn.execute("DELETE FROM saved_tracks WHERE user_id = %s", (demo_user_id,))
    conn.commit()


def seed_demo(conn: psycopg.Connection[Any]) -> tuple[int, int, int]:
    """(Re)build the demo user's playlists and saved tracks from the owner's
    real liked songs. Returns (playlists, filed_tracks, unfiled_tracks)."""
    demo_user_id = get_or_create_demo_user(conn)
    owner_user_id = find_owner_user_id(conn)
    _reset_demo_data(conn, demo_user_id)

    liked = load_owner_liked_songs(conn, owner_user_id)
    by_id = {t.track_id: t for t in liked}
    playlists, leftover = cluster_tracks(liked)

    rng = random.Random(SEED)
    now = datetime.now(UTC)
    filed_ids: set[str] = set()
    unfiled_ids: set[str] = set(leftover)

    # Batch every row up front, then issue a handful of executemany calls —
    # per-row inserts over a remote (Neon) connection are thousands of
    # round-trips and far too slow.
    playlist_rows: list[tuple[Any, ...]] = []
    track_rows: list[tuple[Any, ...]] = []
    profiles: list[PlaylistProfile] = []

    for index, playlist in enumerate(playlists):
        placed, held = split_held_out(playlist.track_ids, HELD_OUT_FRACTION, rng)
        filed_ids.update(placed)
        unfiled_ids.update(held)

        playlist_id = f"demo-pl-{index}"
        # Give the playlist a coherent time window so recency signals vary
        # across the demo library (some recent, some older).
        created_days_ago = rng.randint(30, 365 * 4)
        playlist_rows.append(
            (playlist_id, demo_user_id, playlist.name, playlist.description, len(placed))
        )
        placed_tracks = [by_id[tid] for tid in placed]
        for position, tid in enumerate(placed):
            days = rng.randint(0, created_days_ago)
            track_rows.append((playlist_id, tid, position, now - timedelta(days=days)))
        facts = [
            (t.artist_ids, t.release_year, now - timedelta(days=created_days_ago), [t.tags])
            for t in placed_tracks
        ]
        profiles.append(build_profile(playlist_id, facts))

    # Every liked song is saved for the demo user (filed ones can also be
    # liked, exactly like real Spotify); unfiled ones drive the batch flow.
    saved_rows = [
        (demo_user_id, tid, now - timedelta(days=rng.randint(0, 365 * 4)))
        for tid in (filed_ids | unfiled_ids)
    ]

    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO playlists
                (spotify_id, owner_user_id, name, description, snapshot_id,
                 track_count, is_owned, collaborative)
            VALUES (%s, %s, %s, %s, 'demo', %s, true, false)
            """,
            playlist_rows,
        )
        cur.executemany(
            """
            INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
            VALUES (%s, %s, %s, %s)
            """,
            track_rows,
        )
        cur.executemany(
            """
            INSERT INTO saved_tracks (user_id, track_id, added_at)
            VALUES (%s, %s, %s)
            ON CONFLICT (user_id, track_id) DO NOTHING
            """,
            saved_rows,
        )
    conn.commit()

    for profile in profiles:
        store_profile(conn, profile)

    return len(playlists), len(filed_ids), len(unfiled_ids)


def main() -> int:
    conn = connect()
    try:
        playlists, filed, unfiled = seed_demo(conn)
        print(
            f"demo seeded: {playlists} playlists, {filed} filed tracks, "
            f"{unfiled} unfiled (liked) tracks"
        )
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
