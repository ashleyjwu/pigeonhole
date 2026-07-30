from __future__ import annotations

import json
from typing import Any

import httpx
import pytest

from pigeonhole_worker.spotify import (
    API_BASE,
    QuotaExhaustedError,
    SpotifyClient,
    SpotifyError,
    refresh_access_token,
)


def make_client(
    handler: httpx.MockTransport | Any,
) -> tuple[SpotifyClient, list[float]]:
    sleeps: list[float] = []
    http = httpx.Client(transport=handler)
    return SpotifyClient("token", http=http, sleep=sleeps.append), sleeps


def json_response(
    status: int, body: dict[str, Any], headers: dict[str, str] | None = None
) -> httpx.Response:
    return httpx.Response(status, json=body, headers=headers or {})


def page(items: list[dict[str, Any]], next_url: str | None) -> dict[str, Any]:
    return {"items": items, "next": next_url}


# ── pagination ───────────────────────────────────────────────────────────


def test_paginates_through_next_urls() -> None:
    calls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(str(request.url))
        if "offset=50" in str(request.url):
            return json_response(200, page([{"id": "c"}], None))
        return json_response(
            200, page([{"id": "a"}, {"id": "b"}], f"{API_BASE}/me/playlists?offset=50&limit=50")
        )

    client, _ = make_client(httpx.MockTransport(handler))
    items = list(client.get_my_playlists())
    assert [i["id"] for i in items] == ["a", "b", "c"]
    assert len(calls) == 2
    assert "limit=50" in calls[0]


def test_auth_header_sent() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["Authorization"] == "Bearer token"
        return json_response(200, page([], None))

    client, _ = make_client(httpx.MockTransport(handler))
    list(client.get_saved_tracks())


# ── retry / backoff ──────────────────────────────────────────────────────


def test_huge_retry_after_raises_quota_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(429, {}, headers={"Retry-After": "21600"})

    client, sleeps = make_client(httpx.MockTransport(handler))
    with pytest.raises(QuotaExhaustedError, match="quota"):
        list(client.get_my_playlists())
    assert sleeps == []  # fail fast, never sleep


def test_429_honors_retry_after_then_succeeds() -> None:
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return json_response(429, {}, headers={"Retry-After": "3"})
        return json_response(200, page([{"id": "x"}], None))

    client, sleeps = make_client(httpx.MockTransport(handler))
    items = list(client.get_my_playlists())
    assert [i["id"] for i in items] == ["x"]
    assert sleeps == [3.0]


def test_retries_5xx_with_backoff_floor() -> None:
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] <= 2:
            return json_response(503, {})
        return json_response(200, page([], None))

    client, sleeps = make_client(httpx.MockTransport(handler))
    list(client.get_my_playlists())
    assert sleeps == [1.0, 2.0]  # exponential floor, no Retry-After header


def test_gives_up_after_max_attempts() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(429, {}, headers={"Retry-After": "1"})

    client, sleeps = make_client(httpx.MockTransport(handler))
    with pytest.raises(SpotifyError) as excinfo:
        list(client.get_my_playlists())
    assert excinfo.value.status == 429
    assert len(sleeps) == 4  # MAX_ATTEMPTS - 1 retries


def test_non_retryable_error_raises_immediately() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(403, {"error": "forbidden"})

    client, sleeps = make_client(httpx.MockTransport(handler))
    with pytest.raises(SpotifyError) as excinfo:
        list(client.get_my_playlists())
    assert excinfo.value.status == 403
    assert sleeps == []


# ── playlist items endpoint (Feb-2026 path) ─────────────────────────────


def test_playlist_items_uses_new_endpoint() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/playlists/p1/items"
        return json_response(200, page([{"item": {"id": "t1"}}], None))

    client, _ = make_client(httpx.MockTransport(handler))
    items = list(client.get_playlist_items("p1"))
    assert items == [{"item": {"id": "t1"}}]


# ── token refresh ────────────────────────────────────────────────────────


def test_refresh_access_token_posts_credentials() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url == httpx.URL("https://accounts.spotify.com/api/token")
        body = request.content.decode()
        assert "grant_type=refresh_token" in body
        assert "refresh_token=old-refresh" in body
        assert request.headers["Authorization"].startswith("Basic ")
        return json_response(200, {"access_token": "new", "expires_in": 3600})

    payload = refresh_access_token(
        "id", "secret", "old-refresh", http=httpx.Client(transport=httpx.MockTransport(handler))
    )
    assert payload["access_token"] == "new"


def test_refresh_failure_raises() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(400, text=json.dumps({"error": "invalid_grant"}))

    with pytest.raises(SpotifyError) as excinfo:
        refresh_access_token(
            "id", "secret", "bad", http=httpx.Client(transport=httpx.MockTransport(handler))
        )
    assert excinfo.value.status == 400
