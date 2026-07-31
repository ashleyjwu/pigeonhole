"""Content-based playlist scoring — Python port of web/lib/scoring/score.ts.

Used by the offline evaluation harness (and later the re-ranker trainer). The
TypeScript implementation is the online one; both must stay
behavior-identical, which is enforced by shared test vectors in
shared/scoring-vectors.json consumed by both test suites.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

MIN_ERA_STD = 3.0


@dataclass(frozen=True)
class ScoreWeights:
    artist: float
    era: float


DEFAULT_WEIGHTS = ScoreWeights(artist=0.85, era=0.15)


@dataclass(frozen=True)
class ProfileFacts:
    """The slice of a playlist profile the scorer needs."""

    playlist_id: str
    artist_weights: Mapping[str, float]
    era_mean: float | None
    era_std: float | None
    era_count: int


def artist_component(
    artist_ids: Sequence[str], profile: ProfileFacts
) -> tuple[float, list[str]]:
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


def score_playlist(
    artist_ids: Sequence[str],
    release_year: int | None,
    profile: ProfileFacts,
    weights: ScoreWeights = DEFAULT_WEIGHTS,
) -> float:
    """Blend of available components, normalized over their weights."""
    artist_score, _ = artist_component(artist_ids, profile)
    era_score = era_component(release_year, profile)

    weighted_sum = weights.artist * artist_score
    total_weight = weights.artist
    if era_score is not None:
        weighted_sum += weights.era * era_score
        total_weight += weights.era
    return weighted_sum / total_weight if total_weight > 0 else 0.0
