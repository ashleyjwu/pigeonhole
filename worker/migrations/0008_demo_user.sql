-- 0008_demo_user: mark the synthetic demo user.
-- The public demo reuses the owner's real liked songs (real tracks/artists/
-- genre tags) but wraps them in fabricated, non-personal playlists owned by
-- a separate demo user, so real playlist names are never exposed. This flag
-- lets the web app resolve the demo user for the cookie-based demo session
-- and keeps it clearly distinct from real OAuth users.

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;
