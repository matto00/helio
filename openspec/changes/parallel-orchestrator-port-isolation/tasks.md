## 1. Backend — sbt Worktree Isolation

- [x] 1.1 Create `backend/.sbtopts` with `-Dsbt.ivy.home=.ivy2` to scope the Ivy cache to the worktree

## 2. Frontend — Vite Port Configuration

- [x] 2.1 Update `frontend/vite.config.ts` to read `process.env.PORT` and set `server.port` (default 5173) with `strictPort: true`

## 3. Agent — Evaluator Port Awareness

- [x] 3.1 Update `.claude/agents/linear-evaluator.md` Phase 3 dev-server startup to pass `PORT=${DEV_PORT:-5173}` and use `DEV_PORT` (default 5173) in the Playwright base URL

## 4. Agent — Orchestrator DEV_PORT Assignment

- [x] 4.1 Update `.claude/agents/linear-orchestrator.md` to derive `DEV_PORT` from the ticket ID (5173 + ticket number) before invoking the evaluator, and pass it in both cycle-1 spawns and cycle-2/3 SendMessage resumes
