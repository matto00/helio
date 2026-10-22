## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9`. The planning artifacts are untracked in `openspec/changes/cache-e2e-node-modules/`.

### What I verified (with evidence)

**Round-1 change requests**

- **CR1 (pidfile trigger): addressed.**
  - D5 now adds an explicit `lane-start` subcommand and leaves `start`/`wait` byte-for-byte unchanged.
  - The spec requires that `start` never writes `backend.pid`, and has a "CI start unchanged" scenario covering the selftest harness.
  - `lane-start` refuses a live record using a signal-0 probe only. That matches the existing `wait` (`scripts/e2e-backend.sh:67` already uses `kill -0 -- -$pgid`), so it adds no new kind of signalling.
  - `selftest:ci-sbt` is now in task 2.4. Task 3.2 adds a selftest.
- **CR2 (admin dir source): addressed.**
  - D5 resolves the admin dir with `git -C "$(dirname "$0")/.." rev-parse --absolute-git-dir`.
  - `stop-servers.sh:54-62` computes `git -C "$WORKTREE_PATH" rev-parse --absolute-git-dir`/`concertino-servers`. These are the same dir when the worktree's own copy of the script runs.
  - Step 1 (`stop-servers.sh:143-148`) reads `backend.pid`, group-TERMs it if the pid leads its group, then removes the file. So D6 frees the record before `lane-start` runs.
- **CR3 (AC1 owner): addressed.**
  - Constraint C1 is in `tasks.md` and in `workflow-state.md` CONSTRAINTS.
  - Task 5.1 is the post-merge task, owned by the orchestrator.
  - The pre-merge miss-path proxy (task 4.3, Measurement plan "Pre-merge") is concrete: `gh cache list --ref refs/pull/<N>/merge`, the save step skipped, and both `npm ci` steps run.
  - The PR-body disclosure of the lockfile-PR timeout exposure is stated.
- **CR4 (task 4.1 precondition): addressed.**
  - 4.1 starts from `start-servers.sh` servers on 7131/10038.
  - After the final stop it requires an empty `ps -o pid= -g <pgid>` and both ports free, then `start-servers.sh` + `assert-phase.sh servers`.
  - If the thin-client server interferes, it must be resolved with documented commands only or escalated.

**Other checks**

- **Spec scenario "lane start" is observable.** `Main.scala:237` logs `CORS allowed origins: {}`, so "the backend log names `http://localhost:7131`" can be checked.
- **D3 save leg exists.** The `ci.yml` e2e matrix is `shard: [1..6]` (line 575), so `matrix.shard == 1` is a real leg.
- **Action layout matches D1/D2.** In `.github/actions/e2e-setup/action.yml`, setup-node (line 39) comes before `npm ci` (lines 46/48). A restore step placed between them can use the setup-node `node-version` output.
- **`e2e-prod-build.mjs` matches D6.** It reads `DEV_PORT`/`BACKEND_PORT` (lines 19-20) and serves preview on DEV_PORT. D6's env-prefixed invocation is correct.
- **Premise evidence** (`.concertino/runs/HEL-1699/evidence/premise-validation.md`) agrees with the above.

### New defect the revision introduced

The task 3.2 selftest has no specified isolation. As designed, it would write into the real lane's server record.

- D5 deliberately has no override for the admin dir: it comes only from the script's own location.
- The selftest harness runs the real script in the checkout: `scripts/ci-sbt-selftest/harness.mjs:10`, `E2E = join(root, "scripts", "e2e-backend.sh")`.
- So the "refuses a live record" and "replaces a dead one" cases in task 3.2 can only be exercised by planting or replacing `<this worktree's git admin dir>/concertino-servers/backend.pid`. In this lane that is `.git/worktrees/HEL-1699/concertino-servers/backend.pid`.
- That is the record `start-servers.sh` writes, and the executor's servers will normally be up while it runs selftests (task 4.1 even starts from that state).
- The "dead record" case overwrites the live record. The successful replacement then writes the stand-in `java Hang` PID there. Cleanup deletes or leaves that file.
- This is the same harm round-1 CR1 named: the real backend group is lost, `stop-servers.sh` falls back to listener-only signalling and leaks the sbt JVM, and a stale PID is left behind (a PID-reuse hazard). The difference is that this time the trigger is the new selftest rather than `start`.
- The same happens whenever anyone runs the selftest in any lane, and in the main checkout's `.git/concertino-servers/`.

### Verdict: REFUTE

### Change Requests

1. **Specify how the `lane-start` selftest (D5 last paragraph, task 3.2) is isolated from the real git admin dir. Make that isolation a stated acceptance signal.**
   - Recommended: the selftest copies `scripts/e2e-backend.sh` and `scripts/lib/ci-sbt-diag.sh` into a throwaway `git init` repo under the harness `tmp`, at the same relative layout (`<tmp-repo>/scripts/...`). It runs `lane-start` there with `SBT_CMD`=stand-in and `BACKEND_DIR`=tmp dir, so `git -C "$(dirname "$0")/.."` resolves to the throwaway repo's `.git`.
   - It then asserts against `<tmp-repo>/.git/concertino-servers/backend.pid`.
   - Add an explicit task-3.2 check that the real worktree's `concertino-servers/backend.pid` is byte-identical (or equally absent) before and after `npm run selftest:ci-sbt` / the new selftest. Run it with lane servers up.
   - If the design instead adds an admin-dir override env var, it must say why that does not reopen CR2. I recommend against an override; the copy-to-temp-repo approach keeps D5's single source of truth.
   - Also state that the selftest cleans up only the PGIDs it recorded in the temp repo, like the existing harness, so it never runs `stop-servers.sh` against real ports.

### Non-blocking notes

- "`start`/`wait` byte-for-byte unchanged" and "then runs the existing `wait` logic" pull in different directions. If the wait loop is refactored into a function, the 3.2 `git diff` check fails. The simplest shape that satisfies both is for `lane-start` to set `BACKEND_LOG`/`BACKEND_PGIDFILE`/`HEALTH_URL`/`PORT`/`CORS_ALLOWED_ORIGINS`, then invoke `"$0" start` and `exec "$0" wait`, copying the pgid file to `backend.pid` in between. Only the usage line changes.
- `lane-start` must `mkdir -p "<admin>/concertino-servers"`: in a fresh lane that has never run `start-servers.sh`, the dir may not exist.
- The remaining round-1 notes (the ~3 s useless `~/.npm` restore on a hit, mentioned in the header comment) are reflected in Risks. Make sure they reach the action header comment as task 2.1 says.
