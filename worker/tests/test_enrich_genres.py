from __future__ import annotations

from pigeonhole_worker.enrich_genres import enrich_genres
from pigeonhole_worker.lastfm import LastFmError


class FakeRepo:
    def __init__(self, artists: list[tuple[str, str]]) -> None:
        self._artists = artists
        self.stored: dict[str, dict[str, float]] = {}

    def artists_needing_genre_tags(self, limit: int) -> list[tuple[str, str]]:
        return self._artists[:limit]

    def store_genre_tags(self, artist_id: str, tags: dict[str, float]) -> None:
        self.stored[artist_id] = tags


class FakeSource:
    def __init__(self, by_name: dict[str, list[tuple[str, int]]]) -> None:
        self._by_name = by_name
        self.requested: list[str] = []

    def get_artist_top_tags(self, artist_name: str) -> list[tuple[str, int]]:
        self.requested.append(artist_name)
        if artist_name == "__raises__":
            raise LastFmError(500, "boom")
        return self._by_name.get(artist_name, [])


def test_enriches_and_normalizes_each_artist() -> None:
    repo = FakeRepo([("a1", "Alvvays"), ("a2", "Beach House")])
    source = FakeSource(
        {
            "Alvvays": [("dream pop", 100), ("shoegaze", 50)],
            "Beach House": [("dream pop", 80)],
        }
    )
    stats = enrich_genres(repo, source)

    assert stats.attempted == 2
    assert stats.tagged == 2
    assert stats.no_tags == 0
    assert stats.errors == 0
    assert repo.stored["a1"] == {"dream pop": 1.0, "shoegaze": 0.5}
    assert repo.stored["a2"] == {"dream pop": 1.0}
    assert source.requested == ["Alvvays", "Beach House"]


def test_artists_with_no_tags_are_still_marked_fetched() -> None:
    repo = FakeRepo([("a1", "Obscure Artist")])
    stats = enrich_genres(repo, FakeSource({}))
    assert stats.no_tags == 1
    assert repo.stored["a1"] == {}


def test_errors_are_counted_and_do_not_mark_fetched() -> None:
    repo = FakeRepo([("a1", "__raises__"), ("a2", "Fine Artist")])
    source = FakeSource({"Fine Artist": [("indie", 10)]})
    stats = enrich_genres(repo, source)

    assert stats.errors == 1
    assert stats.tagged == 1
    assert "a1" not in repo.stored  # left unset so it retries next run
    assert repo.stored["a2"] == {"indie": 1.0}


def test_respects_limit() -> None:
    repo = FakeRepo([("a1", "X"), ("a2", "Y"), ("a3", "Z")])
    stats = enrich_genres(repo, FakeSource({}), limit=2)
    assert stats.attempted == 2
