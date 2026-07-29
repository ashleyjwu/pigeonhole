# Design — Foundation & Ingestion

## Overview
Two packages share one Postgres database. The **worker** (Python) owns batch ingestion
and migrations. The **web** app (Next.js) owns authentication, and later the online
suggestion API. Redis (Upstash) carries sync jobs and caching.

## Compute split
- Worker (offline/batch): OAuth token refresh for background sync, full/incremental
  library sync, and (later) playlist profiling, embeddings, and re-ranker training.
- Web (online): OAuth login (Auth.js), enqueuing a sync after login, and (later)
  low-latency scoring of one track against precomputed playlist profiles + write-back.

## Authentication
- Auth.js (NextAuth v5) with the Spotify provider; callback `/api/auth/callback/spotify`.
- On sign-in, upsert `users` and store tokens in `spotify_accounts`, encrypted with
  AES-256-GCM using `TOKEN_ENCRYPTION_KEY` (32-byte base64). The same key is shared with
  the worker so it can decrypt for background refresh.
- Encryption module (`web/lib/crypto`): `encrypt(plaintext) -> {iv, ciphertext, tag}`
  packed into `bytea`; `decrypt` verifies the auth tag (tamper detection). Unit-tested
  for round-trip and tamper rejection.
- Access tokens are refreshed server-side when expired; nothing sensitive is sent to the
  client.

## Data model (Postgres)
```sql
CREATE EXTENSION IF NOT EXISTS vector;

users(
  id uuid PK default gen_random_uuid(),
  spotify_id text UNIQUE NOT NULL,
  display_name text, email text,
  created_at timestamptz NOT NULL default now(),
  last_synced_at timestamptz
);

spotify_accounts(
  user_id uuid PK REFERENCES users(id) ON DELETE CASCADE,
  access_token_enc bytea NOT NULL,
  refresh_token_enc bytea NOT NULL,
  access_expires_at timestamptz NOT NULL,
  scope text NOT NULL
);

artists(
  spotify_id text PK, name text NOT NULL,
  genres text[] NOT NULL default '{}', popularity int,
  fetched_at timestamptz NOT NULL default now()
);

tracks(
  spotify_id text PK, name text NOT NULL,
  artist_ids text[] NOT NULL default '{}',
  album_name text, release_year int, popularity int,
  explicit boolean, duration_ms int,
  fetched_at timestamptz NOT NULL default now()
);

playlists(
  spotify_id text PK,
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL, description text,
  snapshot_id text NOT NULL, track_count int NOT NULL default 0,
  is_owned boolean NOT NULL default true,
  collaborative boolean NOT NULL default false,
  last_synced_at timestamptz
);

playlist_tracks(
  playlist_id text REFERENCES playlists(spotify_id) ON DELETE CASCADE,
  track_id text REFERENCES tracks(spotify_id) ON DELETE CASCADE,
  position int, added_at timestamptz,
  PRIMARY KEY (playlist_id, track_id)
);

saved_tracks(
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  track_id text REFERENCES tracks(spotify_id) ON DELETE CASCADE,
  added_at timestamptz,
  PRIMARY KEY (user_id, track_id)
);

-- populated in later phases
playlist_profiles(
  playlist_id text PK REFERENCES playlists(spotify_id) ON DELETE CASCADE,
  genre_dist jsonb, artist_set text[], era_stats jsonb,
  centroid vector,           -- dimension decided when embeddings land
  updated_at timestamptz NOT NULL default now()
);

feedback_events(
  id bigserial PK,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  track_id text NOT NULL, playlist_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('accepted','dismissed')),
  created_at timestamptz NOT NULL default now()
);
```

## Migrations
- Raw SQL files under `worker/migrations/` (`0001_init.sql`, ...) applied by a small
  idempotent runner (tracks applied versions in a `schema_migrations` table). Alembic
  can be adopted later if we introduce SQLAlchemy.
- Web reads/writes the same DB via a typed query layer (Drizzle recommended) or `pg`.

## Spotify client
- Endpoints used: `GET /me`, `GET /me/playlists`, `GET /playlists/{id}/tracks`,
  `GET /me/tracks`, `GET /artists?ids=` (batched 50), `GET /search`,
  `GET /me/player/currently-playing`, `POST /playlists/{id}/tracks`.
- Shared behavior: bearer auth, pagination helper, and 429 handling that honors
  `Retry-After` with capped exponential backoff. Two implementations (TS for web, Python
  for worker) kept behavior-compatible and covered by fixture-based tests.

## Ingestion / sync algorithm
1. Refresh the access token if expired.
2. Page through `GET /me/playlists`; upsert `playlists` (capture `snapshot_id`).
3. For each playlist: if `snapshot_id` matches the stored value, **skip**; else page
   through its tracks, upsert `tracks` + `playlist_tracks`, update `snapshot_id` and
   `last_synced_at`.
4. Page through `GET /me/tracks`; upsert `saved_tracks`.
5. Collect all referenced artist IDs; batch `GET /artists?ids=` (50 at a time); upsert
   `artists` with genres.
6. All writes are upserts keyed by primary key -> idempotent and safe to re-run.
Runs as a Redis-queued job enqueued by the web app after login and on a schedule.

## Fixtures
- `worker` dump script authenticates as the owner and writes raw JSON responses to
  `data/` (gitignored). A sanitized subset (a few playlists, tracks, artists) is
  committed under `worker/tests/fixtures/` and `web/lib/spotify/__fixtures__/` for tests.

## Testing strategy
- Web: Vitest unit tests for crypto (round-trip/tamper), the Spotify client
  (pagination + 429 via mocked fetch), and utilities.
- Worker: pytest for the sync algorithm (full + incremental via snapshot_id) against
  fixtures, and the migration runner idempotency.

## Sequencing / current blockers
- Web verification is deferred until Node >= 20.9 is installed and `npm install` is run
  in `web/`. Worker tasks begin once Python >= 3.11 is available. These are the two
  human checkpoints gating the start of coding.
