-- 0003_profile_artist_weights: store per-artist prominence for content scoring.
-- `genre_dist` stays as a reserved-but-unused column: Spotify removed genres
-- for dev-mode apps, so profiles are built from artist prominence + era only.

ALTER TABLE playlist_profiles ADD COLUMN IF NOT EXISTS artist_weights jsonb;
