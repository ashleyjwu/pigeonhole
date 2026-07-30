-- 0001_init: core library schema.
-- All statements are guarded so a partially-applied run can be repaired by re-running.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS users (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    spotify_id      text UNIQUE NOT NULL,
    display_name    text,
    email           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_synced_at  timestamptz
);

CREATE TABLE IF NOT EXISTS spotify_accounts (
    user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    access_token_enc   bytea NOT NULL,
    refresh_token_enc  bytea NOT NULL,
    access_expires_at  timestamptz NOT NULL,
    scope              text NOT NULL
);

CREATE TABLE IF NOT EXISTS artists (
    spotify_id  text PRIMARY KEY,
    name        text NOT NULL,
    genres      text[] NOT NULL DEFAULT '{}',
    popularity  int,
    fetched_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracks (
    spotify_id    text PRIMARY KEY,
    name          text NOT NULL,
    artist_ids    text[] NOT NULL DEFAULT '{}',
    album_name    text,
    release_year  int,
    popularity    int,
    explicit      boolean,
    duration_ms   int,
    fetched_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS playlists (
    spotify_id     text PRIMARY KEY,
    owner_user_id  uuid REFERENCES users(id) ON DELETE CASCADE,
    name           text NOT NULL,
    description    text,
    snapshot_id    text NOT NULL,
    track_count    int NOT NULL DEFAULT 0,
    is_owned       boolean NOT NULL DEFAULT true,
    collaborative  boolean NOT NULL DEFAULT false,
    last_synced_at timestamptz
);

CREATE TABLE IF NOT EXISTS playlist_tracks (
    playlist_id  text REFERENCES playlists(spotify_id) ON DELETE CASCADE,
    track_id     text REFERENCES tracks(spotify_id) ON DELETE CASCADE,
    position     int,
    added_at     timestamptz,
    PRIMARY KEY (playlist_id, track_id)
);

CREATE TABLE IF NOT EXISTS saved_tracks (
    user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
    track_id  text REFERENCES tracks(spotify_id) ON DELETE CASCADE,
    added_at  timestamptz,
    PRIMARY KEY (user_id, track_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_tracks_track ON playlist_tracks (track_id);
CREATE INDEX IF NOT EXISTS idx_playlists_owner ON playlists (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_saved_tracks_track ON saved_tracks (track_id);
