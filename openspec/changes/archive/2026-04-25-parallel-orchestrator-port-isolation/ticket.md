# HEL-55 — Support parallel orchestrator runs via port isolation and sbt worktree separation

## Description

The agentic Linear ticket delivery workflow runs each ticket in an isolated git worktree. Currently, running two orchestrators in parallel fails because the dev server and sbt both use shared global state.

Two specific failure modes:

1. **Port collision** — the Evaluator's Phase 3 dev server always starts on port 5173. A second evaluator running simultaneously hits EADDRINUSE and emits a false BLOCKER.
2. **sbt lock contention** — sbt shares a global target directory and `.ivy2` cache across worktrees. Parallel backend test runs deadlock or error.

## What will change

* Dev server startup in evaluation is made port-aware: detect if the default port is in use and either pick a free port dynamically or derive a stable port from the ticket ID (e.g. 5173 + ticket number offset)
* sbt is configured per-worktree to use an isolated target directory (via `-Dsbt.target` or equivalent), preventing lock contention between parallel test runs
* Vite config (or the npm dev script) is updated to accept a `PORT` environment variable so the evaluator can pass a specific port at startup

Note: Docker containerization would provide full isolation if the dev environment grows to require external services, but is out of scope here.

## Acceptance Criteria

- [ ] Two orchestrators can run simultaneously on different tickets without either dev server failing to start
  (orchestrator assigns a unique DEV_PORT per ticket; external callers may also set DEV_PORT directly)
- [ ] Two orchestrators can run simultaneous backend test suites without sbt lock contention or deadlock
- [ ] The Evaluator's Phase 3 Playwright tests correctly target the port used by that session's dev server
- [ ] A single orchestrator run (the common case) is unaffected in behavior and startup time
