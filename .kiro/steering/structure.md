# Repo Structure & Conventions

## Layout
```
web/                     Next.js app (UI, API routes/server actions, Auth.js)
  app/                   App Router routes
  lib/                   framework-agnostic logic (scoring, spotify client, utils)
  *.test.ts              colocated unit tests
worker/                  Python worker (ingestion, ML) — added when Python 3.11+ ready
.github/workflows/ci.yml CI (web now; worker job enabled later)
.kiro/steering/          always-on guidance (this dir)
.kiro/specs/             feature specs (requirements/design/tasks)
.kiro/hooks/             verification hooks
data/                    (gitignored) full personal Spotify dumps for offline dev
```

## Conventions
- TypeScript `strict` everywhere; avoid `any` without a written reason.
- Keep business logic (scoring, sync) in framework-agnostic modules
  (`web/lib/**`, worker packages) so it is unit-testable without Next.js or HTTP.
- Colocate tests: `*.test.ts` (web), `test_*.py` (worker).
- Offline-first: develop against fixtures. Keep full personal dumps in `data/`
  (gitignored); commit only small **sanitized** sample fixtures for tests/CI.
- Conventional Commits. Build/verify before every commit.

## Where things go
- Spotify client + types: `web/lib/spotify/` (TS) and a worker Spotify client (PY).
- Online suggestion scoring (pure functions): `web/lib/scoring/`.
- Batch profiling / embeddings / re-ranker training: `worker/`.
- DB schema + migrations: owned by the worker (single source of truth); the web app
  reads/writes the same Postgres. (Confirm and detail in each spec's design.)
