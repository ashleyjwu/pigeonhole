from __future__ import annotations

from pigeonhole_worker.enrich_genres import EnrichStats
from pigeonhole_worker.onboard_user import drain_genre_enrichment


def test_drains_until_queue_empty() -> None:
    rounds = [
        EnrichStats(attempted=200, tagged=150, no_tags=50),
        EnrichStats(attempted=30, tagged=20, no_tags=10),
        EnrichStats(attempted=0),  # nothing left to enrich
    ]
    it = iter(rounds)
    resolved = drain_genre_enrichment(lambda: next(it))
    assert resolved == 230


def test_stops_when_a_round_makes_no_progress() -> None:
    # First round resolves some; second attempts only artists that all error
    # (progress == 0) — should stop rather than spin forever.
    rounds = [
        EnrichStats(attempted=200, tagged=200, no_tags=0),
        EnrichStats(attempted=5, tagged=0, no_tags=0, errors=5),
        EnrichStats(attempted=5, tagged=0, no_tags=0, errors=5),
    ]
    it = iter(rounds)
    calls = 0

    def enrich_once() -> EnrichStats:
        nonlocal calls
        calls += 1
        return next(it)

    resolved = drain_genre_enrichment(enrich_once)
    assert resolved == 200
    assert calls == 2  # stopped after the first no-progress round


def test_respects_max_rounds() -> None:
    # A source that never drains must be bounded by max_rounds.
    resolved = drain_genre_enrichment(
        lambda: EnrichStats(attempted=200, tagged=200, no_tags=0), max_rounds=3
    )
    assert resolved == 600


def test_empty_immediately() -> None:
    resolved = drain_genre_enrichment(lambda: EnrichStats(attempted=0))
    assert resolved == 0
