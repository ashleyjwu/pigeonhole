from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from pigeonhole_worker.scoring import (
    DEFAULT_WEIGHTS,
    ProfileFacts,
    ScoreWeights,
    artist_component,
    era_component,
    recency_multiplier,
    score_playlist,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "scoring-vectors.json").read_text()
)

NOW = datetime(2026, 7, 31, tzinfo=UTC)
RECENT = NOW - timedelta(days=30)
OLD = NOW - timedelta(days=365 * 5)


def profile_from(case: dict) -> ProfileFacts:  # type: ignore[type-arg]
    p = case["profile"]
    return ProfileFacts(
        playlist_id="p",
        artist_weights=p["artistWeights"],
        era_mean=p["eraMean"],
        era_std=p["eraStd"],
        era_count=p["eraCount"],
        oldest_track_added_at=(
            datetime.fromisoformat(p["oldestTrackAddedAt"]) if p["oldestTrackAddedAt"] else None
        ),
        newest_track_added_at=(
            datetime.fromisoformat(p["newestTrackAddedAt"]) if p["newestTrackAddedAt"] else None
        ),
    )


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_shared_vectors(case: dict) -> None:  # type: ignore[type-arg]
    profile = profile_from(case)
    artist_ids = case["track"]["artistIds"]
    year = case["track"]["releaseYear"]
    expected = case["expected"]
    vector_now = datetime.fromisoformat(case["now"])

    artist_score, matched = artist_component(artist_ids, profile)
    assert artist_score == pytest.approx(expected["artist"], abs=1e-12)
    assert matched == expected["matched"]

    era_score = era_component(year, profile)
    if expected["era"] is None:
        assert era_score is None
    else:
        assert era_score == pytest.approx(expected["era"], abs=1e-12)

    assert score_playlist(artist_ids, year, profile, now=vector_now) == pytest.approx(
        expected["score"], abs=1e-12
    )


def test_zero_weight_profile_scores_zero() -> None:
    profile = ProfileFacts("p", {}, None, None, 0)
    assert score_playlist(["a"], None, profile, now=NOW) == 0.0


# ── recency ──────────────────────────────────────────────────────────────


def test_recency_multiplier_neutral_when_no_dates() -> None:
    profile = ProfileFacts("p", {}, None, None, 0)
    assert recency_multiplier(profile, DEFAULT_WEIGHTS, NOW) == 1.0


def test_recency_multiplier_applies_created_boost() -> None:
    profile = ProfileFacts("p", {}, None, None, 0, oldest_track_added_at=RECENT)
    assert recency_multiplier(profile, DEFAULT_WEIGHTS, NOW) == DEFAULT_WEIGHTS.created_boost


def test_recency_multiplier_applies_updated_boost() -> None:
    profile = ProfileFacts("p", {}, None, None, 0, newest_track_added_at=RECENT)
    assert recency_multiplier(profile, DEFAULT_WEIGHTS, NOW) == DEFAULT_WEIGHTS.updated_boost


def test_recency_multiplier_stacks_when_both_recent() -> None:
    profile = ProfileFacts(
        "p", {}, None, None, 0, oldest_track_added_at=RECENT, newest_track_added_at=RECENT
    )
    expected = DEFAULT_WEIGHTS.created_boost * DEFAULT_WEIGHTS.updated_boost
    assert recency_multiplier(profile, DEFAULT_WEIGHTS, NOW) == pytest.approx(expected)


def test_recency_multiplier_ignores_old_dates() -> None:
    profile = ProfileFacts(
        "p", {}, None, None, 0, oldest_track_added_at=OLD, newest_track_added_at=OLD
    )
    assert recency_multiplier(profile, DEFAULT_WEIGHTS, NOW) == 1.0


def test_recency_multiplier_boundary_is_inclusive() -> None:
    from pigeonhole_worker.scoring import RECENCY_WINDOW

    exactly_at_cutoff = NOW - RECENCY_WINDOW
    profile = ProfileFacts("p", {}, None, None, 0, newest_track_added_at=exactly_at_cutoff)
    assert recency_multiplier(profile, DEFAULT_WEIGHTS, NOW) == DEFAULT_WEIGHTS.updated_boost


def test_score_playlist_scales_by_recency() -> None:
    profile = ProfileFacts("p", {"a1": 1.0}, None, None, 0, newest_track_added_at=RECENT)
    base = score_playlist(["a1"], None, ProfileFacts("p", {"a1": 1.0}, None, None, 0), now=NOW)
    boosted = score_playlist(["a1"], None, profile, now=NOW)
    assert boosted == pytest.approx(base * DEFAULT_WEIGHTS.updated_boost)


def test_score_playlist_recency_does_not_rescue_zero_relevance() -> None:
    # A recently-updated but completely irrelevant playlist must still score 0
    # — recency is multiplicative, so it can never manufacture relevance.
    profile = ProfileFacts("p", {"someone-else": 1.0}, None, None, 0, newest_track_added_at=RECENT)
    assert score_playlist(["a1"], None, profile, now=NOW) == 0.0


def test_custom_boost_weights_are_respected() -> None:
    weights = ScoreWeights(artist=0.85, era=0.15, created_boost=2.0, updated_boost=1.0)
    profile = ProfileFacts("p", {}, None, None, 0, oldest_track_added_at=RECENT)
    assert recency_multiplier(profile, weights, NOW) == 2.0
