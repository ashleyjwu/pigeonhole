from __future__ import annotations

import pytest

from pigeonhole_worker.run import QUOTA_BUFFER_SECONDS, run_until_complete
from pigeonhole_worker.spotify import QuotaExhaustedError
from pigeonhole_worker.sync import SyncStats


def test_returns_immediately_on_success() -> None:
    sleeps: list[float] = []
    result = run_until_complete(lambda: SyncStats(playlists_synced=5), sleep=sleeps.append)
    assert result.playlists_synced == 5
    assert sleeps == []


def test_sleeps_through_quota_and_resumes() -> None:
    sleeps: list[float] = []
    attempts = {"n": 0}

    def attempt() -> SyncStats:
        attempts["n"] += 1
        if attempts["n"] <= 2:
            raise QuotaExhaustedError(3600.0)
        return SyncStats(playlists_synced=250)

    result = run_until_complete(attempt, sleep=sleeps.append)
    assert result.playlists_synced == 250
    assert attempts["n"] == 3
    assert sleeps == [3600.0 + QUOTA_BUFFER_SECONDS] * 2


def test_gives_up_after_max_retries() -> None:
    sleeps: list[float] = []

    def attempt() -> SyncStats:
        raise QuotaExhaustedError(60.0)

    with pytest.raises(QuotaExhaustedError):
        run_until_complete(attempt, sleep=sleeps.append, max_retries=3)
    assert len(sleeps) == 3  # slept 3 times, 4th failure propagates


def test_non_quota_errors_propagate_immediately() -> None:
    sleeps: list[float] = []

    def attempt() -> SyncStats:
        raise RuntimeError("db down")

    with pytest.raises(RuntimeError, match="db down"):
        run_until_complete(attempt, sleep=sleeps.append)
    assert sleeps == []
