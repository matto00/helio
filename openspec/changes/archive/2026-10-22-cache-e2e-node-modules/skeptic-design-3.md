## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9`. The planning artifacts are untracked in `openspec/changes/cache-e2e-node-modules/`.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/cache-e2e-npm-installs/HEL-1699`.

**Round-2 CR1 (selftest isolation from the real git admin dir): addressed.**

- **`design.md` D5, selftest paragraph.** It states that the selftest "never touches the real git admin dir". To do that, it copies `scripts/e2e-backend.sh` and `scripts/lib/ci-sbt-diag.sh` into a throwaway `git init` repo under its own tmp dir, using the same relative layout, and runs that copy with a stub `SBT_CMD`. It also says explicitly that "no admin-dir override env var is added".
  - So `git -C "$(dirname "$0")/.." rev-parse --absolute-git-dir` resolves to the throwaway repo's `.git`. D5's single source of truth (CR2 of round 1) is preserved.
  - The layout works mechanically: `scripts/e2e-backend.sh:30` sources the library relative to its own location, `$(dirname "${BASH_SOURCE[0]}")/lib/ci-sbt-diag.sh`, so the copied pair resolves inside the temp repo.
- **Acceptance signal.** The real worktree's `concertino-servers/backend.pid` must be byte-identical (or still absent) before and after a selftest run with lane servers up. This is stated in D5 and repeated in task 3.2.
- **Task 3.2** names the throwaway-repo copies and C2, and lists the four behavioural cases. "Refuses a live record" now carries "(file unchanged)".
- **Standing Constraint C2** says no selftest or local check writes into the real `concertino-servers/`. It is listed first under Standing Constraints in `tasks.md`.

**Round-2 non-blocking notes: taken up.**

- **Shape of `lane-start`.** D5's implementation note says it sets its env, then `"$0" start` and `exec "$0" wait`, so `start`/`wait` stay byte-identical. This works against the real script:
  - `start` (lines 52-57) and `wait` (lines 58-78) read `BACKEND_LOG`, `BACKEND_PGIDFILE`, `HEALTH_URL`, `BACKEND_DIR` and `SBT_CMD` purely from env (lines 17-24).
  - `PORT` and `CORS_ALLOWED_ORIGINS` are inherited by the `setsid` child.
  - The script is executable (`-rwxr-xr-x`), so `exec "$0"` works when invoked as `scripts/e2e-backend.sh`.
- **`mkdir -p concertino-servers`** is now in D5.

**New defects introduced by the revision: none found.** What I checked:

- **The dead-record replacement case is safe in the temp repo.** It launches the stub and writes its PID only to the temp repo's `backend.pid`. The existing harness already has the cleanup idiom for this: `scripts/ci-sbt-selftest/e2e-die.mjs` ends with `finally { kill -KILL -- -<pgid this test recorded> }`.
- **The spec is consistent with D5.** The "CI start unchanged" scenario lists the local `selftest:ci-sbt` harness, and the "live record is not overwritten" scenario says the file is unchanged.
- **The proposal, design and tasks still agree** on scope: no timeout raised, and rendered concertino scripts untouched.

### Verdict: CONFIRM

### Non-blocking notes

- **Selftest cleanup.** D5 does not say in words that the new selftest kills only the PGIDs it recorded in the temp repo, which round 2 asked for. Follow the `e2e-die.mjs` `finally` idiom, and never call `stop-servers.sh` from a selftest.
- **Port choice in the selftest.** Its `BACKEND_PORT` must be one that never answers (for example 9, like `e2e-backend.sh`'s `HEALTH_URL` default in `harness.mjs`, `e2eEnv`). Otherwise the "refuses an answering port" check could fire first and mask the live/dead-record cases. Also check the refusal message, so each case proves the reason it is meant to.
- **Byte-identical check.** It is planned as one-off evidence. Consider also asserting it inside the selftest (snapshot the real worktree's `backend.pid` before and after), so the isolation guard is permanent rather than a single observation.
- **Backend dir.** `BACKEND_DIR` defaults to the relative `backend`. `lane-start` therefore only works from the repo root, which is how the README sequence runs it. Either default it to `<script repo root>/backend` in `lane-start`, or say in the README that it runs from the worktree root.
