-- 0007_track_album_fields: per-track album art + a few free extras.
-- All three come from the SAME track object already fetched during sync
-- (playlist items / saved tracks) -- no new endpoint, no extra API cost.
--
--   album_image_url: real per-track cover art for the hover-preview feature
--     (playlists.image_url only covers the playlist as a whole, not songs).
--   isrc: a globally unique recording code (external_ids.isrc). Lets a
--     future feature detect the same recording under different Spotify
--     track ids (e.g. a remaster/deluxe reissue), which currently get
--     scored as unrelated tracks.
--   album_id: the album's Spotify id, for a future album-level grouping
--     feature without needing to re-fetch tracks.

ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album_image_url text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS isrc text;
ALTER TABLE tracks ADD COLUMN IF NOT EXISTS album_id text;
