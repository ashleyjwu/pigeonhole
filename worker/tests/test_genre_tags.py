from __future__ import annotations

from pigeonhole_worker.genre_tags import normalize_tags


def test_ranks_by_count_and_normalizes_to_top() -> None:
    tags = normalize_tags([("dream pop", 100), ("shoegaze", 50), ("indie", 25)])
    assert tags == {"dream pop": 1.0, "shoegaze": 0.5, "indie": 0.25}


def test_filters_denylisted_tags() -> None:
    tags = normalize_tags([("shoegaze", 100), ("seen live", 90), ("Favorite", 80)])
    assert tags == {"shoegaze": 1.0}


def test_merges_duplicate_tags_case_insensitively() -> None:
    tags = normalize_tags([("Dream Pop", 40), ("dream pop", 30), ("shoegaze", 20)])
    # 40 + 30 = 70 for "dream pop", now ranked above shoegaze (20)
    assert tags == {"dream pop": 1.0, "shoegaze": 20 / 70}


def test_caps_at_max_tags() -> None:
    raw = [(f"tag{i}", 100 - i) for i in range(20)]
    tags = normalize_tags(raw, max_tags=5)
    assert len(tags) == 5
    assert set(tags) == {"tag0", "tag1", "tag2", "tag3", "tag4"}


def test_drops_zero_or_negative_counts() -> None:
    assert normalize_tags([("junk", 0), ("also junk", -5)]) == {}


def test_empty_input() -> None:
    assert normalize_tags([]) == {}


def test_all_denylisted_returns_empty() -> None:
    assert normalize_tags([("seen live", 100), ("favorite", 50)]) == {}
