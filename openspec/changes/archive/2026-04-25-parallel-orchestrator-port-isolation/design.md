## Context

The linear-evaluator agent starts a Vite dev server (Phase 3) and runs sbt tests against the backend. Both
processes assume fixed global resources: Vite always binds 5173, and sbt resolves `target/` and `.ivy2` relative
to the user home. A second parallel orchestrator session hits EADDRINUSE on the dev server and deadlocks sbt.

Current state:
- `frontend/vite.config.ts` — no `server.port` configured; Vite defaults to 5173.
- `frontend/package.json` `dev` script — `vite` with no port argument.
- `backend/build.sbt` — no sbt target override; uses `<project>/target` which is in the worktree but `.ivy2`
  defaults to `~/.ivy2` (shared global).
- `.claude/agents/linear-evaluator.md` — starts dev server without port awareness.

## Goals / Non-Goals

**Goals:**
- Vite accepts `PORT` env var; single-orchestrator behavior (port 5173) is unchanged.
- sbt isolates its Ivy cache per-worktree so parallel `sbt test` runs don't share the lock.
- Evaluator agent uses `DEV_PORT` (defaulting to 5173) for its Playwright base URL.

**Non-Goals:**
- PostgreSQL or other external service isolation.
- Docker containerization.
- Changes to production build or deployment configuration.

## Decisions

### Decision 1: Vite port via `server.port` in `vite.config.ts`

Read `parseInt(process.env.PORT ?? "5173")` in `vite.config.ts` and set `server.port`.
Alternative: pass `--port` CLI flag in `package.json`. Rejected — the config file approach keeps the
script clean and is the idiomatic Vite way; it also applies uniformly to callers that don't go through
the npm script (e.g. direct `npx vite` calls from the evaluator).

### Decision 2: sbt Ivy cache isolation via `.sbtopts`

Create `backend/.sbtopts` with `-Dsbt.ivy.home=.ivy2` (relative path resolved by sbt to the project
base directory). This is the documented `.sbtopts` mechanism — sbt reads it automatically on startup
with no changes to `build.sbt`. The `target/` directory is already per-worktree; only the Ivy cache is
truly shared globally.

Alternative: override in `build.sbt` with `ivyPaths`. Rejected — `.sbtopts` doesn't require modifying
build logic and applies to all sbt commands uniformly.

### Decision 3: Evaluator reads `DEV_PORT` env var

The orchestrator or caller sets `DEV_PORT=<port>` before invoking the evaluator. The evaluator uses
`DEV_PORT` (defaulting to 5173) when starting the dev server and composing the Playwright base URL.
The evaluator already has a "start the dev server" section in Phase 3 — this is a one-line change.

## Risks / Trade-offs

- Isolated Ivy caches per-worktree increase disk usage (each worktree downloads its own Ivy artifacts).
  Mitigation: worktrees are short-lived; artifacts are small relative to modern disk sizes.
- A PORT that's already in use will still fail, but with `strictPort: true` set in vite config the error
  is immediate and clear rather than silently falling back to another port. This makes EADDRINUSE explicit.
- `.sbtopts` affects all developers cloning the repo. The `.ivy2` path is relative, so it works correctly
  on any machine and doesn't break the non-parallel case (slightly slower first run per worktree).

## Planner Notes

- Self-approved: no breaking API changes, no new external services, no security surface change.
- The evaluator agent file lives in `.claude/agents/linear-evaluator.md` — executor must update Phase 3
  dev-server startup block to pass `PORT=$DEV_PORT` and use `DEV_PORT` in the Playwright base URL.
- `strictPort: true` in vite.config.ts ensures failure is loud when a port collision does occur, which
  is preferable to silently binding a random port that the evaluator doesn't know about.
