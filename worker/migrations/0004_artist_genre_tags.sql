-- 0004_artist_genre_tags: Last.fm-sourced genre signal.
-- Spotify removed artist genres for dev-mode apps in the Feb-2026 changes
-- (see steering/tech.md), so genre now comes from a separate enrichment job
-- (pigeonhole_worker.enrich_genres) rather than the Spotify sync.

ALTER TABLE artists ADD COLUMN IF NOT EXISTS genre_tags jsonb;
ALTER TABLE artists ADD COLUMN IF NOT EXISTS genre_fetched_at timestamptz;
