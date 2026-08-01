# Verification & Autonomy Protocol

## The loop
Every change is self-verified before moving on: **write code -> run checks -> fix ->
repeat.** Never mark a task done on unverified code, and never claim something passed
without running it.

## Definition of done (per task)
- **Web:** `npm run verify` (typecheck + lint + test) passes; if the change affects the
  build, `npm run build` passes too.
- **Worker:** `ruff check .`, `mypy .`, and `pytest -q` all pass.
- New behavior ships with a test. Bug fixes ship with a regression test.

## Verify commands
- Web (from `web/`): `npm run verify` then, if relevant, `npm run build`
- Worker (from `worker/`): `ruff check . && mypy . && pytest -q`

## Offline-first
Develop and test against committed fixtures/mocks so work runs with **no live Spotify
calls and no secrets**. Full personal dumps live in `data/` (gitignored); small
sanitized fixtures are committed for tests and CI.

## Human checkpoints (do NOT attempt autonomously)
- Creating the Spotify developer app; pasting the client secret.
- Connecting/authorizing Vercel, Neon, Upstash, Fly/Render accounts.
- Anything touching real secrets, billing, or production data.
- Subjective UX / product judgment calls.

## Known current blockers
- **Node must be >= 20.9.0** to build/verify the web app (dev machine is on 18). Until
  then, web verification is deferred and CI is the safety net once pushed.
- **Worker needs Python >= 3.11** (dev machine is on 3.9). The worker package is not yet
  created; its hooks and CI job stay dormant until `worker/pyproject.toml` exists.

## Git
- Conventional Commits. Build/verify before committing. Never force-push or rewrite
  pushed history. Never run `git push` unless explicitly asked.
- **Keep commit messages short.** Subject line + a few bullet points max. No user-request
  framing ("per user feedback", "user asked for") — just what changed and why, plus a
  results/impact line (e.g. before/after numbers) when there is one to report.
