"""Last.fm API client for artist genre tags.

Fills the genre gap left by Spotify's Feb-2026 removal of artist genres for
dev-mode apps (see steering/tech.md). Last.fm's artist.getTopTags returns
crowd-sourced folksonomy tags — noisier than a curated taxonomy, but real
signal, and normalize_tags() filters the non-genre noise.

Last.fm's API terms ask for "reasonable" usage; third-party trackers cite a
~5 req/sec courtesy limit, so this client self-throttles with a fixed delay
between calls rather than relying on the server to push back (unlike the
Spotify client, Last.fm has no documented Retry-After contract to react to).
No API key is bundled — request one free at last.fm/api/account/create and
set LASTFM_API_KEY.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from typing import Any

import httpx

API_BASE = "https://ws.audioscrobbler.com/2.0/"
MAX_ATTEMPTS = 3
RETRYABLE_STATUSES = {429, 500, 502, 503}

# Self-imposed delay between requests (courtesy rate limit; Last.fm gives no
# Retry-After to react to, so we throttle proactively rather than reactively).
DEFAULT_DELAY_SECONDS = 0.25


class LastFmError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"Last.fm API error {status}: {message}")
        self.status = status


class LastFmClient:
    def __init__(
        self,
        api_key: str,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
        delay_seconds: float = DEFAULT_DELAY_SECONDS,
    ) -> None:
        self._api_key = api_key
        self._http = http or httpx.Client(timeout=15)
        self._sleep = sleep
        self._delay_seconds = delay_seconds

    def get_artist_top_tags(self, artist_name: str) -> list[tuple[str, int]]:
        """Raw (tag_name, count) pairs for an artist, most-applied first.

        Returns [] for unknown artists (Last.fm's own "not found" case) —
        callers should not treat that as an error.
        """
        params = {
            "method": "artist.gettoptags",
            "artist": artist_name,
            "api_key": self._api_key,
            "format": "json",
            "autocorrect": "1",  # tolerate minor name variants/typos
        }
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = self._http.get(API_BASE, params=params)
            except httpx.TransportError as error:
                # Network-level failure (timeout, connection reset, DNS...) —
                # no status code to check, so retry unconditionally up to the
                # attempt cap rather than letting it crash the whole batch.
                if attempt < MAX_ATTEMPTS:
                    self._sleep(2 ** (attempt - 1))
                    continue
                msg = f"network error after {MAX_ATTEMPTS} attempts: {error}"
                raise LastFmError(0, msg) from error
            if response.status_code == 200:
                payload: dict[str, Any] = response.json()
                if "error" in payload:
                    # Last.fm error 6 = "artist not found" — not a failure.
                    if payload.get("error") == 6:
                        self._sleep(self._delay_seconds)
                        return []
                    raise LastFmError(int(payload["error"]), str(payload.get("message", "")))
                self._sleep(self._delay_seconds)
                return _parse_tags(payload)
            if response.status_code in RETRYABLE_STATUSES and attempt < MAX_ATTEMPTS:
                self._sleep(2 ** (attempt - 1))
                continue
            raise LastFmError(response.status_code, response.text)
        raise AssertionError("unreachable")


def _parse_tags(payload: dict[str, Any]) -> list[tuple[str, int]]:
    tags = ((payload.get("toptags") or {}).get("tag")) or []
    if isinstance(tags, dict):  # Last.fm returns a bare object for a single tag
        tags = [tags]
    result: list[tuple[str, int]] = []
    for tag in tags:
        name = tag.get("name")
        count = tag.get("count")
        if name is None or count is None:
            continue
        try:
            result.append((str(name), int(count)))
        except (TypeError, ValueError):
            continue
    return result
