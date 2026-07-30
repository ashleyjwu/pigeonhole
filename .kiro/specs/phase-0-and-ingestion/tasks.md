# Tasks — Foundation & Ingestion

Legend: `[x]` done · `[ ]` todo · **(checkpoint)** needs a human step.

## 0. Foundation (substrate)
- [x] 0.1 Monorepo layout, git init, root `.gitignore`, env example files
- [x] 0.2 Next.js 16 + TS (strict) + Tailwind + ESLint + Vitest; green baseline test
- [x] 0.3 GitHub Actions CI (web job); worker job prepared but disabled
- [x] 0.4 Steering files + verification hooks
- [ ] 0.5 **(checkpoint)** Upgrade dev machine to Node >= 20.9 and Python >= 3.11
- [ ] 0.6 **(checkpoint)** `cd web && npm install` on Node 20 to sync the lockfile and
  install Vitest; confirm `npm run verify` and `npm run build` pass
  _Requirements: 1.1, 1.2_

## 1. Persistence schema (worker owns migrations)
- [x] 1.1 Create `worker/` package: `pyproject.toml` with ruff, mypy, pytest configured
- [x] 1.2 DB connection helper (psycopg) reading `DATABASE_URL`
- [x] 1.3 Migration `0001_init.sql`: enable pgvector; create users, spotify_accounts,
  artists, tracks, playlists, playlist_tracks, saved_tracks
- [x] 1.4 Migration `0002_profiles.sql`: playlist_profiles, feedback_events
- [x] 1.5 Idempotent migration runner + `schema_migrations` table; pytest for re-run
  safety
- [ ] 1.6 **(checkpoint)** Apply migrations to the live Neon database
  (`python -m pigeonhole_worker.migrate`) with user approval
  _Requirements: 5.1, 5.2, 5.3_

## 2. Spotify authentication (web)
- [ ] 2.1 Add and configure Auth.js (NextAuth v5) Spotify provider with the required
  scopes
- [ ] 2.2 AES-256-GCM crypto module (`web/lib/crypto`) + unit tests (round-trip, tamper)
- [ ] 2.3 Persist user + encrypted tokens to Postgres on sign-in
- [ ] 2.4 Server-side access-token refresh on expiry; tokens never sent to the client
  _Requirements: 2.1, 2.2, 2.3, 2.4_

## 3. Spotify client + types
- [ ] 3.1 TS client (`web/lib/spotify`): typed wrappers, pagination, 429/backoff
- [ ] 3.2 Python client (worker): same endpoints for batch sync + token refresh
- [ ] 3.3 Fixture-based unit tests for both (no network)
  _Requirements: 3.1, 3.4_

## 4. Ingestion / sync (worker)
- [ ] 4.1 Full sync: playlists -> tracks -> artist genres -> saved tracks; idempotent
  upserts
- [ ] 4.2 Incremental sync via `snapshot_id` (skip unchanged playlists)
- [ ] 4.3 Redis queue + sync job; web enqueues it after login
- [ ] 4.4 429 / `Retry-After` handling with resumable progress
- [ ] 4.5 pytest for full + incremental paths against fixtures
  _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

## 5. Offline fixtures
- [ ] 5.1 **(checkpoint)** Dump script: with owner credentials, write raw responses to
  `data/` (gitignored)
- [ ] 5.2 Sanitize and commit a small sample fixture for tests/CI
  _Requirements: 4.1, 4.2, 4.3_

## 6. CI
- [ ] 6.1 Enable the worker CI job (ruff, mypy, pytest) once `worker/pyproject.toml`
  exists
- [ ] 6.2 Confirm web `npm ci` passes with the synced lockfile
  _Requirements: 1.2, 1.3_
```
