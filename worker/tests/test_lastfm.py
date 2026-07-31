from __future__ import annotations

from collections.abc import Callable

import httpx
import pytest

from pigeonhole_worker.lastfm import LastFmClient, LastFmError


def make_client(
    handler: Callable[[httpx.Request], httpx.Response], delay_seconds: float = 0.0
) -> tuple[LastFmClient, list[float]]:
    sleeps: list[float] = []
    http = httpx.Client(transport=httpx.MockTransport(handler))
    return (
        LastFmClient("key", http=http, sleep=sleeps.append, delay_seconds=delay_seconds),
        sleeps,
    )


def json_response(status: int, body: dict[str, object]) -> httpx.Response:
    return httpx.Response(status, json=body)


def toptags_payload(tags: list[dict[str, object]]) -> dict[str, object]:
    return {"toptags": {"tag": tags, "@attr": {"artist": "Some Artist"}}}


def test_parses_tags_ordered_by_count() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.params["method"] == "artist.gettoptags"
        assert request.url.params["artist"] == "Alvvays"
        assert request.url.params["autocorrect"] == "1"
        return json_response(
            200,
            toptags_payload(
                [{"name": "dream pop", "count": "100"}, {"name": "shoegaze", "count": "50"}]
            ),
        )

    client, _ = make_client(handler)
    assert client.get_artist_top_tags("Alvvays") == [("dream pop", 100), ("shoegaze", 50)]


def test_single_tag_returned_as_bare_object_not_list() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(200, toptags_payload({"name": "solo tag", "count": "10"}))  # type: ignore[arg-type]

    client, _ = make_client(handler)
    assert client.get_artist_top_tags("X") == [("solo tag", 10)]


def test_unknown_artist_returns_empty_not_error() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(200, {"error": 6, "message": "Artist not found"})

    client, _ = make_client(handler)
    assert client.get_artist_top_tags("Nonexistent") == []


def test_other_api_errors_raise() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(200, {"error": 10, "message": "Invalid API key"})

    client, _ = make_client(handler)
    with pytest.raises(LastFmError, match="Invalid API key"):
        client.get_artist_top_tags("X")


def test_retries_5xx_then_succeeds() -> None:
    attempts = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        attempts["n"] += 1
        if attempts["n"] == 1:
            return json_response(503, {})
        return json_response(200, toptags_payload([]))

    client, sleeps = make_client(handler)
    assert client.get_artist_top_tags("X") == []
    assert attempts["n"] == 2
    assert sleeps[0] == 1.0  # backoff sleep before the retry


def test_gives_up_after_max_attempts() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(500, {})

    client, _ = make_client(handler)
    with pytest.raises(LastFmError):
        client.get_artist_top_tags("X")


def test_self_throttles_between_successful_calls() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(200, toptags_payload([]))

    client, sleeps = make_client(handler, delay_seconds=0.25)
    client.get_artist_top_tags("X")
    assert sleeps == [0.25]


def test_skips_malformed_tag_entries() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return json_response(
            200,
            toptags_payload(
                [
                    {"name": "good", "count": "5"},
                    {"name": None, "count": "5"},
                    {"count": "5"},
                    {"name": "bad-count", "count": "not-a-number"},
                ]
            ),
        )

    client, _ = make_client(handler)
    assert client.get_artist_top_tags("X") == [("good", 5)]
