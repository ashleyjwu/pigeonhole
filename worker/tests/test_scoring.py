from __future__ import annotations

import json
from pathlib import Path

import pytest

from pigeonhole_worker.scoring import (
    ProfileFacts,
    artist_component,
    era_component,
    score_playlist,
)

VECTORS = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "scoring-vectors.json").read_text()
)


def profile_from(case: dict) -> ProfileFacts:  # type: ignore[type-arg]
    p = case["profile"]
    return ProfileFacts(
        playlist_id="p",
        artist_weights=p["artistWeights"],
        era_mean=p["eraMean"],
        era_std=p["eraStd"],
        era_count=p["eraCount"],
    )


@pytest.mark.parametrize("case", VECTORS["cases"], ids=[c["name"] for c in VECTORS["cases"]])
def test_shared_vectors(case: dict) -> None:  # type: ignore[type-arg]
    profile = profile_from(case)
    artist_ids = case["track"]["artistIds"]
    year = case["track"]["releaseYear"]
    expected = case["expected"]

    artist_score, matched = artist_component(artist_ids, profile)
    assert artist_score == pytest.approx(expected["artist"], abs=1e-12)
    assert matched == expected["matched"]

    era_score = era_component(year, profile)
    if expected["era"] is None:
        assert era_score is None
    else:
        assert era_score == pytest.approx(expected["era"], abs=1e-12)

    assert score_playlist(artist_ids, year, profile) == pytest.approx(
        expected["score"], abs=1e-12
    )


def test_zero_weight_profile_scores_zero() -> None:
    profile = ProfileFacts("p", {}, None, None, 0)
    assert score_playlist(["a"], None, profile) == 0.0
