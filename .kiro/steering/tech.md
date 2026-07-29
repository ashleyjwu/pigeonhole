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

## Spotify Web API constraints (CRITICAL — verified)
Since the 2024-11-27 changes, **new apps CANNOT use**: audio-features, audio-analysis,
recommendations, related-artists, featured/category playlists, and the 30-second
`preview_url`. **Do not design features on these.**

Still available and used by pigeonhole: user profile; playlists (read + create/modify);
playlist tracks; saved tracks; top tracks/artists; recently-played; artists (incl.
genres); search; currently-playing (Premium). Dev Mode allows ~25 users; the app owner
must have Premium.

## Key decisions
- Classify playlists by **contents, not names**.
- **Suggestion engine v1 = content features** (artist overlap, genre distribution, era,
  popularity). Embeddings (track2vec from playlist co-occurrence) are an **experiment**
  validated against the eval harness, not a foundational assumption — the corpus is
  small (~250 playlists).
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
