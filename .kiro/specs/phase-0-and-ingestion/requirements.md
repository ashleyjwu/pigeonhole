# Requirements — Foundation & Ingestion

## Introduction
This spec covers pigeonhole's foundation (the verification substrate), Spotify
authentication, and the ingestion pipeline that pulls the owner's playlists, tracks,
artist genres, and saved songs into Postgres. It is the prerequisite for the suggestion
engine (a later spec). The guiding constraint: rely only on Spotify endpoints still
available to new apps (no audio-features/recommendations).

## Requirement 1 — Foundation & verification
**User story:** As a developer, I want a self-verifying toolchain, so the AI can build
autonomously and catch its own mistakes.

Acceptance criteria:
1. WHEN `npm run verify` is run in `web/` THEN it SHALL run typecheck, lint, and tests
   and exit non-zero on any failure.
2. WHEN a commit is pushed THEN CI SHALL run the web checks (typecheck, lint, test,
   build) on Node 20.
3. WHERE the worker package exists, CI SHALL run ruff, mypy, and pytest for it.

## Requirement 2 — Spotify authentication
**User story:** As the owner, I want to sign in with Spotify, so pigeonhole can read my
library and modify my playlists.

Acceptance criteria:
1. WHEN a user starts login THEN the system SHALL use Spotify OAuth (Auth.js) requesting
   scopes: `playlist-read-private`, `playlist-read-collaborative`,
   `playlist-modify-private`, `playlist-modify-public`, `user-read-currently-playing`,
   `user-library-read`, `user-read-private`.
2. WHEN OAuth completes THEN the system SHALL persist the user and store the refresh
   token encrypted at rest (AES-256-GCM).
3. WHEN the client requests data THEN the system SHALL NOT expose access or refresh
   tokens to the browser.
4. WHEN an access token is expired THEN the system SHALL refresh it using the refresh
   token before calling Spotify.

## Requirement 3 — Library ingestion
**User story:** As the owner, I want my playlists and their tracks synced, so pigeonhole
can analyze them.

Acceptance criteria:
1. WHEN a sync runs THEN it SHALL fetch all of the user's playlists (paginated), the
   tracks in each, and the genres of the tracks' artists, and persist them.
2. WHEN a sync runs THEN it SHALL fetch the user's saved ("liked") tracks and record
   them.
3. WHEN a playlist's `snapshot_id` is unchanged since the last sync THEN the system
   SHALL skip re-fetching that playlist's tracks.
4. WHEN Spotify responds with HTTP 429 THEN the system SHALL wait per `Retry-After` and
   resume without losing progress.
5. WHEN the same entity is synced twice THEN persistence SHALL be idempotent (upsert, no
   duplicates).

## Requirement 4 — Offline fixtures
**User story:** As a developer, I want a snapshot of a real library, so I can develop and
test without live API calls or secrets.

Acceptance criteria:
1. WHEN the dump script runs with valid owner credentials THEN it SHALL write the raw
   Spotify responses to `data/` (gitignored).
2. THE repository SHALL include a small, sanitized sample fixture committed for tests and
   CI.
3. WHEN unit tests run THEN they SHALL use fixtures/mocks and make no network calls.

## Requirement 5 — Persistence schema
**User story:** As the system, I need a schema to store the library and feedback, so
suggestions can be computed and evaluated.

Acceptance criteria:
1. THE schema SHALL include: `users`, `spotify_accounts`, `artists`, `tracks`,
   `playlists`, `playlist_tracks`, `saved_tracks`, and (for later phases)
   `playlist_profiles` and `feedback_events`.
2. THE database SHALL enable the `pgvector` extension for future embedding storage.
3. WHEN migrations are applied twice THEN the result SHALL be unchanged (idempotent).
