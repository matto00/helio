## Why

Running two agentic orchestrators in parallel on different tickets fails today because the Vite dev server always claims port 5173 and sbt shares a global target directory — causing EADDRINUSE false BLOCKERs and sbt deadlocks. Fixing this unblocks concurrent ticket delivery.

## What Changes

- Vite dev server accepts a `PORT` environment variable so each orchestrator session can start on a different port.
- The npm `dev` script (and any evaluator-facing scripts) forwards `PORT` to Vite.
- sbt is configured per-worktree via a `build.sbt` (or `.sbtopts`) override so `target/` and the Ivy cache resolve inside the worktree, not a shared global path.
- The evaluator agent script uses the session's port when launching Playwright tests.

## Capabilities

### New Capabilities

- `parallel-dev-server-port`: Vite dev server accepts a `PORT` env var to start on a caller-specified port; default remains 5173 for single-orchestrator use.
- `sbt-worktree-isolation`: sbt target and Ivy cache directories are scoped per-worktree so concurrent `sbt test` runs do not contend on shared locks.

### Modified Capabilities

<!-- None — no existing spec-level requirements change -->

## Impact

- `frontend/vite.config.ts` — read `process.env.PORT` and pass to `server.port`.
- `frontend/package.json` — `dev` script passes `PORT` through to Vite.
- `backend/build.sbt` or `backend/.sbtopts` — set `target` base and Ivy home to worktree-local paths when `SBT_WORKTREE_ISOLATION=1`.
- `.claude/agents/linear-evaluator.md` — evaluator picks up port from env and passes it to Playwright.

## Non-goals

- Docker containerization of the dev environment.
- Isolation of PostgreSQL or other external services.
- Changes to production build or deployment pipelines.
