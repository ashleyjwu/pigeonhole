-- 0002_profiles: playlist profiles (computed by the worker) and feedback events.

CREATE TABLE IF NOT EXISTS playlist_profiles (
    playlist_id  text PRIMARY KEY REFERENCES playlists(spotify_id) ON DELETE CASCADE,
    genre_dist   jsonb,
    artist_set   text[] NOT NULL DEFAULT '{}',
    era_stats    jsonb,
    -- Dimension intentionally unspecified until the embedding experiment lands.
    centroid     vector,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_events (
    id          bigserial PRIMARY KEY,
    user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
    track_id    text NOT NULL,
    playlist_id text NOT NULL,
    action      text NOT NULL CHECK (action IN ('accepted', 'dismissed')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_feedback_events_user ON feedback_events (user_id, created_at);
