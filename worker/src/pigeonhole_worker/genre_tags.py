"""Normalize raw Last.fm tags into a filtered, weighted genre signal.

Last.fm tags are crowd-sourced folksonomy: alongside real genre/style tags
("dream pop", "shoegaze") users apply personal-taste or non-genre tags
("seen live", "favorite", "female vocalists"). This filters a denylist of
common non-genre tags, merges duplicate tags (case-insensitive), and keeps
the top N remaining tags normalized to the top tag's count — the same
shape as playlist_profiles.artist_weights: values in (0,1], 1.0 for the
most-applied tag.
"""

from __future__ import annotations

# Common Last.fm tags that describe the listener/context, not the music.
# Not exhaustive by design — this is a first pass, refined as real data
# surfaces more noise (see worker/README or tech.md for how to extend it).
DENYLIST = {
    "seen live",
    "favorite",
    "favorites",
    "favourite",
    "favourites",
    "my favorite",
    "my favorites",
    "awesome",
    "love",
    "love song",
    "love songs",
    "amazing",
    "beautiful",
    "great",
    "great songs",
    "good",
    "best",
    "cool",
    "female vocalists",
    "male vocalists",
    "female vocalist",
    "male vocalist",
    "female",
    "male",
    "spotify",
    "albums i own",
    "artists i like",
    "check out",
    "under 2000 listeners",
}

DEFAULT_MAX_TAGS = 8


def normalize_tags(
    raw_tags: list[tuple[str, int]], max_tags: int = DEFAULT_MAX_TAGS
) -> dict[str, float]:
    """Filter, dedupe, rank, and normalize raw (tag, count) pairs."""
    counts: dict[str, int] = {}
    for name, count in raw_tags:
        if count <= 0:
            continue
        key = name.strip().lower()
        if not key or key in DENYLIST:
            continue
        counts[key] = counts.get(key, 0) + count

    if not counts:
        return {}

    ranked = sorted(counts.items(), key=lambda pair: pair[1], reverse=True)[:max_tags]
    top_count = ranked[0][1]
    return {name: count / top_count for name, count in ranked}
