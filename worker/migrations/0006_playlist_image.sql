-- 0006_playlist_image: cover art for the playlist hover-preview feature.
-- Spotify playlist objects still return an `images` array (unlike genres/
-- popularity, this was not removed in the Feb-2026 dev-mode changes), so
-- this is captured from the existing /me/playlists sync response rather
-- than a new endpoint call.

ALTER TABLE playlists ADD COLUMN IF NOT EXISTS image_url text;
