"""Offline evaluation of the suggestion scorer: leave-one-out placement test.

For every (track, playlist) placement: hold the track out, rebuild its home
playlist's profile WITHOUT it (no leakage), score the track against all
playlists, and record where the true home ranks. Aggregates hit@1, hit@3,
MRR, and mean rank — the project's headline quality metrics.

Rank definition: position of the home playlist when candidates are sorted by
(score desc, playlist_id asc) — deterministic under ties. A placement whose
home scores 0 (no signal) counts as unranked: hit=0, reciprocal rank=0.

Playlists smaller than --min-size (default 2) are skipped as hold-out sources
(removing the only track leaves nothing to profile) but still compete as
candidates.

Age filtering (--max-age-years): grading the algorithm on whether it guesses
placements into a playlist you've abandoned isn't a fair test of how well it
serves you today. When set, playlists whose proxy-creation date (oldest track
add — see profiles.py) is older than the cutoff are dropped entirely from the
evaluation, both as hold-out sources and as competing candidates. Playlists
with no date data (can't determine their age) are conservatively dropped too
— we don't claim fairness for something we can't verify.

Usage:
    python -m pigeonhole_worker.evaluate [--min-size N] [--max-age-years N]
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from pigeonhole_worker.profiles import build_profile
from pigeonhole_worker.scoring import (
    DEFAULT_WEIGHTS,
    ProfileFacts,
    ScoreWeights,
    score_playlist,
)


@dataclass(frozen=True)
class PlacementTrack:
    track_id: str
    artist_ids: tuple[str, ...]
    release_year: int | None
    added_at: datetime | None = None


@dataclass
class PlaylistBreakdown:
    name: str
    placements: int = 0
    hits_at_3: int = 0


@dataclass
class EvalReport:
    placements: int = 0
    hits_at_1: int = 0
    hits_at_3: int = 0
    reciprocal_rank_sum: float = 0.0
    rank_sum: int = 0
    ranked: int = 0
    unranked: int = 0
    by_playlist: dict[str, PlaylistBreakdown] = field(default_factory=dict)

    @property
    def hit_rate_at_1(self) -> float:
        return self.hits_at_1 / self.placements if self.placements else 0.0

    @property
    def hit_rate_at_3(self) -> float:
        return self.hits_at_3 / self.placements if self.placements else 0.0

    @property
    def mrr(self) -> float:
        return self.reciprocal_rank_sum / self.placements if self.placements else 0.0

    @property
    def mean_rank(self) -> float | None:
        return self.rank_sum / self.ranked if self.ranked else None


def filter_by_age(
    playlists: Mapping[str, Sequence[PlacementTrack]],
    max_age_years: float,
    now: datetime,
) -> dict[str, list[PlacementTrack]]:
    """Keep only playlists whose oldest track add is within `max_age_years`
    of `now`. Playlists with no dated tracks are dropped (unverifiable age).
    """
    cutoff = now - timedelta(days=365 * max_age_years)
    kept: dict[str, list[PlacementTrack]] = {}
    for pid, tracks in playlists.items():
        dated = [t.added_at for t in tracks if t.added_at is not None]
        if dated and min(dated) >= cutoff:
            kept[pid] = list(tracks)
    return kept


def _facts(playlist_id: str, tracks: Sequence[PlacementTrack]) -> ProfileFacts:
    profile = build_profile(
        playlist_id, [(list(t.artist_ids), t.release_year, t.added_at) for t in tracks]
    )
    return ProfileFacts(
        playlist_id=playlist_id,
        artist_weights=profile.artist_weights,
        era_mean=profile.era_mean,
        era_std=profile.era_std,
        era_count=profile.era_count,
        oldest_track_added_at=profile.oldest_track_added_at,
        newest_track_added_at=profile.newest_track_added_at,
    )


def evaluate_placements(
    playlists: Mapping[str, Sequence[PlacementTrack]],
    playlist_names: Mapping[str, str] | None = None,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
    min_playlist_size: int = 2,
    now: datetime | None = None,
    max_age_years: float | None = None,
) -> EvalReport:
    """`now` anchors the recency window; defaults to the real current time so
    a plain `evaluate_placements(playlists)` call evaluates "as of today"
    (matching production), while tests pass a fixed value for determinism.

    `max_age_years`, when set, drops playlists older than that (by
    proxy-creation date) from evaluation entirely — both as hold-out sources
    and as competing candidates — before any scoring happens. See
    `filter_by_age` for exactly how age is determined.
    """
    resolved_now = now if now is not None else datetime.now(UTC)
    if max_age_years is not None:
        playlists = filter_by_age(playlists, max_age_years, resolved_now)
    names = playlist_names or {}
    report = EvalReport()
    full_profiles = {pid: _facts(pid, tracks) for pid, tracks in playlists.items()}

    for pid, tracks in playlists.items():
        if len(tracks) < min_playlist_size:
            continue
        breakdown = report.by_playlist.setdefault(
            pid, PlaylistBreakdown(name=names.get(pid, pid))
        )
        for i, held_out in enumerate(tracks):
            remaining = list(tracks[:i]) + list(tracks[i + 1 :])
            home_profile = _facts(pid, remaining)

            scores: dict[str, float] = {}
            for cid, profile in full_profiles.items():
                candidate = home_profile if cid == pid else profile
                scores[cid] = score_playlist(
                    held_out.artist_ids,
                    held_out.release_year,
                    candidate,
                    weights,
                    now=resolved_now,
                )

            report.placements += 1
            breakdown.placements += 1
            if scores[pid] <= 0:
                report.unranked += 1
                continue
            ordered = sorted(scores.items(), key=lambda kv: (-kv[1], kv[0]))
            rank = next(i for i, (cid, _) in enumerate(ordered, start=1) if cid == pid)
            report.ranked += 1
            report.rank_sum += rank
            report.reciprocal_rank_sum += 1.0 / rank
            if rank == 1:
                report.hits_at_1 += 1
            if rank <= 3:
                report.hits_at_3 += 1
                breakdown.hits_at_3 += 1

    return report


def load_placements() -> tuple[dict[str, list[PlacementTrack]], dict[str, str]]:
    """Read all stored playlists and their tracks from Postgres."""
    from pigeonhole_worker.db import connect

    conn = connect()
    try:
        names = {
            row[0]: row[1]
            for row in conn.execute("SELECT spotify_id, name FROM playlists").fetchall()
        }
        playlists: dict[str, list[PlacementTrack]] = {pid: [] for pid in names}
        rows = conn.execute(
            """
            SELECT pt.playlist_id, t.spotify_id, t.artist_ids, t.release_year, pt.added_at
            FROM playlist_tracks pt
            JOIN tracks t ON t.spotify_id = pt.track_id
            ORDER BY pt.playlist_id, pt.position
            """
        ).fetchall()
        for playlist_id, track_id, artist_ids, release_year, added_at in rows:
            playlists[playlist_id].append(
                PlacementTrack(track_id, tuple(artist_ids or []), release_year, added_at)
            )
        return playlists, names
    finally:
        conn.close()


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Evaluate the playlist suggestion scorer.")
    parser.add_argument("--min-size", type=int, default=2)
    parser.add_argument(
        "--max-age-years",
        type=float,
        default=None,
        help="Drop playlists older than this (by oldest track add) from evaluation entirely.",
    )
    args = parser.parse_args(argv)

    playlists, names = load_placements()
    now = datetime.now(UTC)
    if args.max_age_years is not None:
        filtered = filter_by_age(playlists, args.max_age_years, now)
        print(
            f"age filter (<= {args.max_age_years:g}y): kept {len(filtered)}/{len(playlists)} "
            f"playlists ({len(playlists) - len(filtered)} dropped as too old or undated)\n"
        )
        playlists = filtered
        names = {pid: name for pid, name in names.items() if pid in filtered}
    report = evaluate_placements(
        playlists, names, min_playlist_size=args.min_size, now=now
    )

    print(f"placements evaluated: {report.placements}")
    print(f"hit@1: {report.hit_rate_at_1:.3f}")
    print(f"hit@3: {report.hit_rate_at_3:.3f}")
    print(f"MRR:   {report.mrr:.3f}")
    mean_rank = f"{report.mean_rank:.2f}" if report.mean_rank is not None else "n/a"
    print(f"mean rank (when ranked): {mean_rank}")
    print(f"unranked (no signal): {report.unranked}")
    print("\nper-playlist hit@3:")
    for _pid, b in sorted(report.by_playlist.items(), key=lambda kv: kv[1].name.lower()):
        if b.placements:
            print(f"  {b.name!r}: {b.hits_at_3}/{b.placements} ({b.hits_at_3 / b.placements:.2f})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
