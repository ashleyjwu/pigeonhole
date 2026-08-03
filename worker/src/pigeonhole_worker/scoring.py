"""Content-based playlist scoring — Python port of web/lib/scoring/score.ts.

Used by the offline evaluation harness (and later the re-ranker trainer). The
TypeScript implementation is the online one; both must stay
behavior-identical, which is enforced by shared test vectors in
shared/scoring-vectors.json consumed by both test suites.

Recency: Spotify's API exposes no playlist creation date, so "created" is
proxied by the playlist's OLDEST track add (a playlist can't be older than
its oldest addition) and "updated" is the exact newest track add. Both are
applied as MULTIPLICATIVE boosts on the final artist+era+genre score rather
than as additive weighted components — an additive term would let a
zero-relevance playlist surface just for being recently active, which is not
the goal; multiplying preserves score=0 for irrelevant playlists while
nudging up relevant, active ones among otherwise-close candidates.

Genre: Spotify removed artist genres for dev-mode apps, so genre comes from
Last.fm tags (see lastfm.py, genre_tags.py) attached to artists and merged
per playlist in profiles.py. Weight validated against the eval harness
(worker/src/pigeonhole_worker/evaluate.py --genre-weight) before shipping:
on live data, weight 0.2 lifted hit@3 from 0.198->0.257 (full library) and
0.317->0.382 (playlists <=3y old), with MRR gains of similar size. 0.1-0.4
were all within noise of each other, so 0.2 was picked as the middle of
that plateau rather than the single best point, to avoid overfitting.
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
    genre: float = 0.2
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
    genre_dist: Mapping[str, float] | None = None


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


def genre_component(
    track_tags: Mapping[str, float] | None, profile: ProfileFacts
) -> tuple[float | None, list[str]]:
    """Cosine similarity between the track's tag weights and the playlist's
    genre_dist, in [0,1]. Returns None (not 0.0) when either side has no tag
    data at all — mirrors era_component's "no signal -> excluded from the
    weighted average" behavior, rather than being scored as a hard zero.
    A real zero-overlap case (both sides have tags, none in common) still
    returns 0.0, which does count against the score.
    """
    playlist_tags = profile.genre_dist or {}
    if not track_tags or not playlist_tags:
        return None, []
    matched = [tag for tag in track_tags if tag in playlist_tags]
    dot = sum(track_tags[tag] * playlist_tags[tag] for tag in matched)
    track_norm = math.sqrt(sum(w * w for w in track_tags.values()))
    playlist_norm = math.sqrt(sum(w * w for w in playlist_tags.values()))
    if track_norm == 0 or playlist_norm == 0:
        return None, []
    return dot / (track_norm * playlist_norm), matched


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
    track_tags: Mapping[str, float] | None = None,
) -> float:
    """Blend of available components, normalized over their weights, then
    scaled by the recency multiplier. `now` defaults to the real current
    time; tests pass a fixed value for determinism. `track_tags` is the
    candidate's merged artist genre tags (optional; omitted -> genre simply
    doesn't contribute, same as a missing era)."""
    artist_score, _ = artist_component(artist_ids, profile)
    era_score = era_component(release_year, profile)
    genre_score, _ = genre_component(track_tags, profile)

    weighted_sum = weights.artist * artist_score
    total_weight = weights.artist
    if era_score is not None:
        weighted_sum += weights.era * era_score
        total_weight += weights.era
    if genre_score is not None:
        weighted_sum += weights.genre * genre_score
        total_weight += weights.genre
    base = weighted_sum / total_weight if total_weight > 0 else 0.0

    resolved_now = now if now is not None else datetime.now(UTC)
    return base * recency_multiplier(profile, weights, resolved_now)
