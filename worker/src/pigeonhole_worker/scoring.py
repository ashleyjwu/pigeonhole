"""Content-based playlist scoring — Python port of web/lib/scoring/score.ts.

Used by the offline evaluation harness (and later the re-ranker trainer). The
TypeScript implementation is the online one; both must stay
behavior-identical, which is enforced by shared test vectors in
shared/scoring-vectors.json consumed by both test suites.

Recency: Spotify's API exposes no playlist creation date, so "created" is
proxied by the playlist's OLDEST track add (a playlist can't be older than
its oldest addition) and "updated" is the exact newest track add. Both are
applied as MULTIPLICATIVE boosts on the final artist+era score rather than
as additive weighted components — an additive term would let a
zero-relevance playlist surface just for being recently active, which is not
the goal; multiplying preserves score=0 for irrelevant playlists while
nudging up relevant, active ones among otherwise-close candidates.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

MIN_ERA_STD = 3.0

RECENCY_WINDOW = timedelta(days=365 * 2)


@dataclass(frozen=True)
class ScoreWeights:
    artist: float
    era: float
    # Multiplicative boosts, applied only when the respective proxy date is
    # within RECENCY_WINDOW of `now`. 1.0 = no boost.
    created_boost: float = 1.05
    updated_boost: float = 1.15


DEFAULT_WEIGHTS = ScoreWeights(artist=0.85, era=0.15)


@dataclass(frozen=True)
class ProfileFacts:
    """The slice of a playlist profile the scorer needs."""

    playlist_id: str
    artist_weights: Mapping[str, float]
    era_mean: float | None
    era_std: float | None
    era_count: int
    oldest_track_added_at: datetime | None = None
    newest_track_added_at: datetime | None = None


def artist_component(artist_ids: Sequence[str], profile: ProfileFacts) -> tuple[float, list[str]]:
    """Summed prominence of the candidate's artists, clamped to 1."""
    matched: list[str] = []
    total = 0.0
    for artist_id in artist_ids:
        weight = profile.artist_weights.get(artist_id, 0.0)
        if weight > 0:
            matched.append(artist_id)
            total += weight
    return min(total, 1.0), matched


def era_component(release_year: int | None, profile: ProfileFacts) -> float | None:
    """Gaussian era proximity in [0,1]; None when either side lacks years."""
    if release_year is None or profile.era_mean is None or profile.era_count == 0:
        return None
    std = max(profile.era_std or 0.0, MIN_ERA_STD)
    z = (release_year - profile.era_mean) / std
    return math.exp(-0.5 * z * z)


def recency_multiplier(profile: ProfileFacts, weights: ScoreWeights, now: datetime) -> float:
    """1.0, or boosted if the playlist was created/updated within 2 years of
    `now`. Both boosts can stack: since newest >= oldest always, a playlist
    proxy-"created" recently is also proxy-"updated" recently — that is
    correct (a brand-new playlist is definitionally recently active too),
    not double-counting the same evidence twice by mistake.
    """
    multiplier = 1.0
    cutoff = now - RECENCY_WINDOW
    if profile.oldest_track_added_at is not None and profile.oldest_track_added_at >= cutoff:
        multiplier *= weights.created_boost
    if profile.newest_track_added_at is not None and profile.newest_track_added_at >= cutoff:
        multiplier *= weights.updated_boost
    return multiplier


def score_playlist(
    artist_ids: Sequence[str],
    release_year: int | None,
    profile: ProfileFacts,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
    now: datetime | None = None,
) -> float:
    """Blend of available components, normalized over their weights, then
    scaled by the recency multiplier. `now` defaults to the real current
    time; tests pass a fixed value for determinism."""
    artist_score, _ = artist_component(artist_ids, profile)
    era_score = era_component(release_year, profile)

    weighted_sum = weights.artist * artist_score
    total_weight = weights.artist
    if era_score is not None:
        weighted_sum += weights.era * era_score
        total_weight += weights.era
    base = weighted_sum / total_weight if total_weight > 0 else 0.0

    resolved_now = now if now is not None else datetime.now(UTC)
    return base * recency_multiplier(profile, weights, resolved_now)
