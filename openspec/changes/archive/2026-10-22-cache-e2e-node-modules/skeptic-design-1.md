## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9` (planning artifacts untracked in `openspec/changes/cache-e2e-node-modules/`).

### What I verified (with evidence)

- **`~/.npm` was already cached and hit, and root `npm ci` still took 7 min: CONFIRMED.** `gh run view --job 119610619080 --log`:
  `02:52:28.95 Cache hit for: node-cache-Linux-x64-npm-4d1554551c...`, `Cache Size: ~107 MB`, `02:52:31.67 Run npm ci`,
  last output `02:52:36.98` (deprecation warning), then nothing until `02:59:34.95 > husky`, `added 619 packages in 7m`;
  `npm --prefix frontend ci` `added 920 packages ... in 8s`. Job `e2e-prod-build` cancelled at 03:00:35; `e2e (2)`
  (119610619513) cancelled at 03:16:51 (`gh run view 39711300255 --json jobs`).
- **A `node_modules` cache fully replaces the install.** The only `hasInstallScript` packages in either lockfile are
  `fsevents` (x2) and `unrs-resolver`; the root `prepare` is `husky`. Nothing writes outside `node_modules`, so restoring
  both trees and skipping `npm ci` is sound (D1/D2).
- **`e2e-prod-build.mjs` already serves on DEV_PORT: CONFIRMED.** `scripts/e2e-prod-build.mjs`: `vite preview --port devPort --strictPort`,
  and it refuses with "port ... already answers" if DEV_PORT answers. The ticket's "preview serves on another port (7065)"
  is stale (it was the HEL-1632 workaround). The real gap is no documented backend-only start; the design identifies it correctly.
- **CORS/port loading:** `Main.scala:226-237` reads `sys.env` `PORT`, then `HELIO_HTTP_PORT`, default 8080; `CORS_ALLOWED_ORIGINS`
  defaults to `http://localhost:5173`. `backend/project/DevEnv.scala:63-64`: `.env` never overrides a key the process env
  already has ("shell wins"), so the `PORT`/`CORS_ALLOWED_ORIGINS` that `e2e-backend.sh` exports do reach the forked backend in a lane.
- **CI behaviour preserved (D5):** all three action callers (`ci.yml` `e2e` lines 596-597, `e2e-prod-build` 694-695,
  `e2e-slow.yml` 48-49) set `DEV_PORT: 5173`, `BACKEND_PORT: 8080`. `HELIO_HTTP_PORT`/`CORS_ALLOWED_ORIGINS` are set nowhere
  in `.github` except a comment in `cd-backend.yml`. GitHub sets `CI=true`, so the `/tmp/backend.log` / `/tmp/backend.pgid`
  defaults hold. The effective values match today's. The design holds for CI.
- **Would `stop-servers.sh` stop a setsid-launched `sbt --server run` group via `concertino-servers/backend.pid`? Yes.**
  - Step 1 (`stop-servers.sh`, "1. Recorded servers") reads `${PID_DIR}/backend.pid`, where `PID_DIR` = `git -C WORKTREE_PATH rev-parse --absolute-git-dir`/`concertino-servers`.
  - `signal_target` TERMs the whole group when `pgid_of(pid) == pid`.
  - In `e2e-backend.sh`, `setsid` runs from a non-job-control subshell, so the child is not a group leader. `setsid` therefore calls setsid() without forking, and `$!` is both the PID and the PGID.
  - The mechanism is sound. Task 3.3 has to prove it empirically.
- **Main-only save policy vs `openspec/specs/ci-actions-cache-budget`: consistent.**
  - The base spec's "written only from main, exactly one job" pattern matches the existing sbt saves (`ci.yml` 315/320/330: `push && refs/heads/main && matrix.shard == 0 && cache-hit != 'true'`).
  - D3 mirrors that pattern, using e2e leg 1.
  - `ci.yml` triggers on `push: [main]` and `pull_request`.
  - The janitor allowlist (`scripts/cache-janitor.mjs:13-24`) is explicit, and the new regex `^e2e-node-modules-v\d+-` overlaps no existing family.
  - The MODIFIED delta copies the requirement text faithfully and adds the new family.
- **Premise evidence** (`.concertino/runs/HEL-1699/evidence/premise-validation.md`) matches what I re-derived.

### Verdict: REFUTE

The cache half is sound and well-evidenced. The lane half has one real safety defect in how D5 triggers its pidfile write. Separately, the plan does not say how AC1 ("across 5 CI runs") gets closed, given D3 makes pre-merge evidence impossible.

### Change Requests

1. **D5: "write `concertino-servers/backend.pid` whenever `CI` is unset" is too broad and can clobber the lane's real server record.**
   - `scripts/ci-sbt-selftest/harness.mjs` (`e2eEnv`, lines 52-60) runs `e2e-backend.sh start` with `CI` unset whenever `npm run selftest:ci-sbt` runs locally. It overrides `BACKEND_LOG`/`BACKEND_PGIDFILE`, but under D5 that run would still write the stand-in `java Hang` PID into the lane's `.git/worktrees/HEL-1699/concertino-servers/backend.pid`.
   - The consequences:
     - (a) If `start-servers.sh` servers are up, their recorded backend group is lost. `stop-servers.sh` then falls back to step 2, which signals the listener (the forked JVM, not a group leader) only, so the sbt JVM leaks.
     - (b) A stale PID is left for `stop-servers.sh` to group-TERM later, which is a PID-reuse hazard.
   - Revise D5 and the spec so the pidfile is written only on an explicit lane signal. For example: `BACKEND_PORT` set **and** `BACKEND_PGIDFILE` not overridden, or a dedicated opt-in variable that the README sequence sets.
   - Also specify that it refuses to overwrite an existing `backend.pid` whose PID is alive (print a FAIL telling the user to run `stop-servers.sh` first).
   - Add a selftest case asserting a harness-style `start` writes nothing under the git admin dir.
   - Add `npm run selftest:ci-sbt` to task 2.4/3.2. The script it covers is being edited, and today the task list only names the pattern-kill guard.
2. **D5: say where the git admin dir comes from.** `$(git rev-parse --absolute-git-dir)` depends on the cwd. Specify resolving it from the script's own repo root (`git -C "<script dir>/.."`) so it always matches the dir `stop-servers.sh` computes from `WORKTREE_PATH`. Without that, the record can land in another checkout's admin dir (e.g. the main checkout's `.git`) when the script is run from elsewhere.
3. **AC1 has no owning task.**
   - D3 correctly accepts that PR runs always miss. The "After" bullet of the Measurement plan (merge-run save, then 5 or more hit runs with restore duration and both `npm ci` steps skipped) does not appear in `tasks.md`, and nothing says who collects it or when the ticket can close.
   - Add an explicit post-merge task (e.g. "5.1 after merge: record the main push run's save and the entry size via `gh cache list`, then 5 or more runs showing `cache-hit=true`, both `npm ci` steps skipped, and restore duration; append to the scratch dir and the ticket").
   - State in the PR-body requirement that AC1 is unproven at merge and is closed by that task.
   - Add a pre-merge proxy that is actually achievable: the miss-path run on this PR showing the restore step logs a miss and both `npm ci` steps still run (spec scenario "lockfile changed"/miss).
4. **Task 4.1 precondition is unstated.** The realistic state is lane servers already started by `start-servers.sh`, whose backend command is plain `sbt run`. Under sbt 2.0.9 that is the thin client, which can leave a background sbt server (HEL-1339's "starting sbt server in the background" log). That server may survive `stop-servers.sh` and hold the build's server lock against `e2e-backend.sh`'s `sbt --server run`.
   - Require 4.1 to start from `start-servers.sh`-launched servers.
   - Record `ps -o pid,pgid,args -g <recorded pgid>` empty after the final stop.
   - Finish with `start-servers.sh` + `assert-phase.sh servers` to show the lane returns to normal.
   - If an orphaned sbt server blocks the start, the README sequence must cover it with documented scripts only, or escalate. No hand-built commands.

### Non-blocking notes

- On a `node_modules` hit, setup-node `cache: npm` still restores the 107 MB `~/.npm` uselessly (~3 s). This is acceptable as miss insurance. Mention it in the action header comment.
- A PR that changes a lockfile still runs both `npm ci` steps under the unchanged 8-min `e2e-prod-build` timeout. That residual exposure is inherent to the main-only policy and the no-timeout-raise constraint, so say so in the PR body rather than claiming the timeout risk is gone.
- D1 references `steps.<setup-node id>.outputs.node-version`. `actions/setup-node` does expose `node-version`, so the restore step must come after setup-node, as D1 implies.
