from __future__ import annotations

import pytest

from pigeonhole_worker.util import chunked


def test_chunked_splits_evenly() -> None:
    assert list(chunked([1, 2, 3, 4], 2)) == [[1, 2], [3, 4]]


def test_chunked_handles_remainder() -> None:
    assert list(chunked([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]


def test_chunked_empty() -> None:
    assert list(chunked([], 3)) == []


def test_chunked_rejects_nonpositive_size() -> None:
    with pytest.raises(ValueError, match="size must be positive"):
        list(chunked([1, 2, 3], 0))
