-- 0005_profile_recency: recency signal for the scorer.
-- Spotify's API exposes no playlist creation date (confirmed: there is no
-- such field anywhere in the Web API). We proxy it from playlist_tracks:
--   oldest_track_added_at (MIN) approximates "created" — the playlist can be
--     no younger than its oldest addition, so a recent MIN is strong
--     evidence the playlist itself is recent.
--   newest_track_added_at (MAX) is an exact "last updated" timestamp — it
--     literally is the last time a track was added.

ALTER TABLE playlist_profiles ADD COLUMN IF NOT EXISTS oldest_track_added_at timestamptz;
ALTER TABLE playlist_profiles ADD COLUMN IF NOT EXISTS newest_track_added_at timestamptz;
