"""Small utilities for the pigeonhole worker."""

from __future__ import annotations

from collections.abc import Iterable, Iterator
from itertools import islice
from typing import TypeVar

T = TypeVar("T")


def chunked(items: Iterable[T], size: int) -> Iterator[list[T]]:
    """Yield successive lists of at most ``size`` items from ``items``.

    Used to batch Spotify API calls; for example, ``GET /artists`` accepts up
    to 50 IDs per request.
    """
    if size <= 0:
        raise ValueError("size must be positive")
    iterator = iter(items)
    while batch := list(islice(iterator, size)):
        yield batch
