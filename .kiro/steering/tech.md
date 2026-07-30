# Tech & Constraints

## Stack
- **Web:** Next.js 16 (App Router) + React 19 + TypeScript (strict) + Tailwind 4.
  Lives in `web/` (package `pigeonhole-web`). Also hosts API routes / server actions
  and Auth.js.
- **Worker:** Python 3.11+ for ingestion and ML. Lives in `worker/`.
- **DB:** Postgres (Neon) with the `pgvector` extension.
- **Queue / cache:** Redis (Upstash).
- **Auth:** Auth.js (NextAuth v5), Spotify provider. Callback
  `/api/auth/callback/spotify`.

## Runtime requirements (hard)
- **Node >= 20.9.0** — Next 16 will not build on Node 18.
- **Python >= 3.11** for the worker.

## Hosting (all free tier)
- Web -> Vercel. Worker -> Fly.io or Render. DB -> Neon. Redis -> Upstash.
- Free backends sleep and cold-start; handle with loading states and a keep-warm
  cron. Treat this as a known, deliberate tradeoff.

## Spotify Web API constraints (CRITICAL — verified by live probe 2026-07-30)
Two rounds of restrictions apply to this app (created July 2026, Development Mode):

2024-11-27 removals: audio-features, audio-analysis, recommendations,
related-artists, featured/category playlists, 30-second `preview_url`.

Feb-2026 dev-mode changes (verified against the live API with our token):
- `GET /playlists/{id}/tracks` returns **403** -> use `GET /playlists/{id}/items`;
  entries nest the track under `item` (saved tracks still use `track`)
- Playlist objects: `tracks` field renamed to `items` (`items.total`)
- `GET /artists?ids=` (batch) returns **403**; `GET /artists/{id}` works but has
  **no `genres`** field. Artist data comes from (id, name) embedded in tracks.
- Track objects have **no `popularity`** field
- Playlist writes use `POST/PUT/DELETE /playlists/{id}/items`
- Dev Mode: max **5 users**, owner must keep Premium, quotas per developer account

Still available and verified working: `/me`, `/me/playlists`,
`/playlists/{id}/items`, `/me/tracks`, `/me/player/currently-playing`, `/search`,
playlist item writes. **Do not design features on genres, popularity, or any
removed endpoint.** Probe the live API before trusting docs or training data.

## Key decisions
- Classify playlists by **contents, not names**.
- **Suggestion engine v1 = content features from available data**: artist overlap
  (primary signal), track co-occurrence across playlists, era (release_year), album
  and artist-name signals. Genre and popularity are NOT available (Feb-2026 API).
  Embeddings (track2vec from playlist co-occurrence) are an **experiment** validated
  against the eval harness — co-occurrence is now more important, not less, since it
  partially substitutes for the missing genre signal.
- **Compute split:** the **worker** owns batch/offline work (sync, playlist profiles,
  embeddings, re-ranker training); the **web** app owns low-latency **online scoring**
  (compare one track's features to the ~250 precomputed playlist profiles in-process,
  apply learned weights, return top-N) and Spotify write-back.
- Brute-force ranking is fine at this scale; `pgvector` is for clean storage and future
  scale, not performance necessity.
- Encrypt Spotify refresh tokens at rest (AES-256-GCM). Tokens never reach the client.

## Commands
- Web (from `web/`): `npm run dev | build | typecheck | lint | test | verify`.
- Worker (from `worker/`, once set up): `ruff check .`, `mypy .`, `pytest -q`.
