"""Spotify Web API client for batch ingestion.

Endpoints limited to what pigeonhole is allowed to use (post-2024 API rules)
and what sync needs: playlists, playlist tracks, saved tracks, artists, and
token refresh. Pagination follows `next` URLs; 429 responses honor
Retry-After with capped retries. HTTP is injectable for network-free tests.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from typing import Any

import httpx

API_BASE = "https://api.spotify.com/v1"
TOKEN_URL = "https://accounts.spotify.com/api/token"

MAX_ATTEMPTS = 5
RETRYABLE_STATUSES = {429, 500, 502, 503}
PAGE_LIMIT = 50

# A Retry-After beyond this means the dev-mode quota is exhausted, not a burst
# limit. Fail fast so the (resumable) sync can be re-run later instead of
# silently sleeping for potentially hours.
MAX_RETRY_AFTER_SECONDS = 120.0


class QuotaExhaustedError(RuntimeError):
    def __init__(self, retry_after: float) -> None:
        super().__init__(
            f"Spotify asked us to wait {retry_after:.0f}s — the dev-mode API quota "
            "is exhausted. Re-run the sync later; completed playlists are skipped."
        )
        self.retry_after = retry_after


class SpotifyError(RuntimeError):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(f"Spotify API error {status}: {message}")
        self.status = status


def refresh_access_token(
    client_id: str,
    client_secret: str,
    refresh_token: str,
    http: httpx.Client | None = None,
) -> dict[str, Any]:
    """Exchange a refresh token for a new access token.

    Returns the raw token payload: access_token, expires_in, and sometimes a
    rotated refresh_token that the caller must persist.
    """
    client = http or httpx.Client()
    try:
        response = client.post(
            TOKEN_URL,
            data={"grant_type": "refresh_token", "refresh_token": refresh_token},
            auth=(client_id, client_secret),
        )
        if response.status_code != 200:
            raise SpotifyError(response.status_code, response.text)
        payload: dict[str, Any] = response.json()
        return payload
    finally:
        if http is None:
            client.close()


class SpotifyClient:
    def __init__(
        self,
        access_token: str,
        http: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._http = http or httpx.Client(timeout=30)
        self._sleep = sleep
        self._headers = {"Authorization": f"Bearer {access_token}"}

    # ── low-level request with retry/backoff ────────────────────────────

    def _get(self, url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            response = self._http.get(url, params=params, headers=self._headers)
            if response.status_code == 200:
                payload: dict[str, Any] = response.json()
                return payload
            if response.status_code in RETRYABLE_STATUSES and attempt < MAX_ATTEMPTS:
                retry_after = float(response.headers.get("Retry-After", 0) or 0)
                if retry_after > MAX_RETRY_AFTER_SECONDS:
                    raise QuotaExhaustedError(retry_after)
                # Exponential backoff floor so 5xx without Retry-After still waits.
                self._sleep(max(retry_after, 2 ** (attempt - 1)))
                continue
            raise SpotifyError(response.status_code, response.text)
        raise AssertionError("unreachable")

    def _paginate(self, url: str, params: dict[str, Any]) -> Iterator[dict[str, Any]]:
        page = self._get(url, params)
        while True:
            yield from page["items"]
            next_url = page.get("next")
            if not next_url:
                return
            # `next` already encodes the query parameters.
            page = self._get(next_url, None)

    # ── endpoints (Feb-2026 dev-mode surface; verified by live probe) ────

    def get_my_playlists(self) -> Iterator[dict[str, Any]]:
        return self._paginate(f"{API_BASE}/me/playlists", {"limit": PAGE_LIMIT})

    def get_playlist_items(self, playlist_id: str) -> Iterator[dict[str, Any]]:
        """Playlist entries. NOTE: /playlists/{id}/tracks returns 403 for
        dev-mode apps since Feb 2026; /items is the replacement and nests the
        track under the ``item`` key."""
        return self._paginate(
            f"{API_BASE}/playlists/{playlist_id}/items",
            {"limit": PAGE_LIMIT},
        )

    def get_saved_tracks(self) -> Iterator[dict[str, Any]]:
        return self._paginate(f"{API_BASE}/me/tracks", {"limit": PAGE_LIMIT})
