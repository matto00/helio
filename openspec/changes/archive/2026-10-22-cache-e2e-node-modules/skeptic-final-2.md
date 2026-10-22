## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: c3b30a4a5362b5cf451f23d90a3a7acf65052eae. Base resolved live with `resolve-review-base.sh` (exit 0): da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9. I reviewed the whole change `da39f0f14...HEAD`, not only the cycle-3 delta.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/cache-e2e-npm-installs/HEL-1699`.

**AC1: install time cut (item 1).** I read `.github/actions/e2e-setup/action.yml` in the diff:
- `setup-node` now has `id: setup-node`.
- `actions/cache/restore@v6` restores `node_modules` and `frontend/node_modules`. The key is exact: `e2e-node-modules-v1-<os>-<arch>-node<setup-node.outputs.node-version>-<hashFiles(both lockfiles)>`. There are no `restore-keys`.
- Both `npm ci` steps carry `if: steps.node-modules.outputs.cache-hit != 'true'`.
- The save step runs only when `inputs.save-node-modules-cache == 'true'`, the event is a push to `refs/heads/main`, and the restore missed. It reuses `cache-primary-key`.

In `ci.yml`, the `e2e` matrix is `shard: [1, 2, 3, 4, 5, 6]` (I checked the values; they are not 0-based). It passes `save-node-modules-cache: ${{ matrix.shard == 1 }}`, so exactly one leg can save. `e2e-prod-build` (ci.yml:726) and `e2e-slow.yml:59` pass no input, so they use the default `"false"` and only restore.

Skipping `npm ci` on a hit loses nothing. Root `package.json` has only `prepare: husky`, and `frontend/package.json` has no install hooks.

The hit side of AC1 can only be observed after merge, because only main writes the cache. That is accepted constraint C1. Tasks 4.3 (miss-path plan for the PR body) and 5.1 (5 post-merge hit runs) are still unchecked, which is correct: they are delivery-phase obligations for the orchestrator.

**Cache budget.** The `cache-janitor.mjs` family `e2e-node-modules` uses `/^e2e-node-modules-v\d+-/` with keep 1. The selftest cases cover superseded, newest, PR-ref and near-miss keys. This matches the `ci-actions-cache-budget` and `e2e-node-modules-cache` spec deltas.

**AC2: a lane runs `npm run e2e:prod-build` with the documented scripts.** I re-ran the README sequence myself, verbatim, starting from the lane's `start-servers.sh` state. That is the thin-client hazard D5 asked to test. Playwright ran under the e2e flock with 2 workers and `nice -n 19`. Output:
- `stop-servers.sh`: `STOPPED ports=7131,10038`, rc=0.
- `lane-start`: `lane-start pid=131087 record=.../.git/worktrees/HEL-1699/concertino-servers/backend.pid ... cors=http://localhost:7131`, then `backend healthy after 7s`, rc=0.
- Group 131087 contained `sbt --server run`, the sbt launcher JVM and the forked backend JVM.
- The fresh log (truncated at start, timestamp 09:30:04) had `CORS allowed origins: http://localhost:7131`.
- `npm run e2e:prod-build`: preview served on `http://localhost:7131/`, `3 passed (8.1s)` (prod-build-guard, hel1631 :183, hel1632 :260), rc=0.
- `stop-servers.sh`: rc=0. `ps -g 131087` afterwards was empty, so `stop-servers.sh` stopped the whole lane-start group.
- `start-servers.sh`: `READY backend=http://localhost:10038/health`, `READY frontend=http://localhost:7131`. `assert-phase.sh servers` printed `PASS servers`. The lane servers are restored.

This independently reproduces the executor's claimed `lane-readme-sequence.txt`.

I could not persist the raw log of this run with `persist-evidence.sh`: it printed `FAIL source is not inside any git working tree`, because the log is in the session scratchpad and I write nothing else into the worktree. The quoted lines above are the evidence.

**`e2e-backend.sh` CI path unchanged.** In the diff, the `start` and `wait` branches are byte-identical. Only the header comment, the new `lane-start` case and the usage line changed. `lane-start`:
- uses only `kill -0` on the recorded pid, with no signal sent;
- refuses when the record is live or `/health` already answers;
- exports `PORT`, `CORS_ALLOWED_ORIGINS`, `HEALTH_URL`, and a log and pgid file local to the admin dir;
- re-invokes `start`, writes the record, then `exec`s `wait`.

**Selftest (cycle-3 delta, the promoted race).** In `e2e-backend.sh` the `wait` loop runs, in order: health curl, the `TOTAL_TIMEOUT` check, group liveness, then the stage check. With the stub sleeping 20 s, `STAGE_TIMEOUT=1` and `TOTAL_TIMEOUT=30`, the stage check is the only failure that can be reached in case 4, so the race is closed. I ran `npm run selftest:e2e-backend-lane` 3 times: rc=0 each time, 13/13 checks every run.

**C2.** sha256 of the real `.git/worktrees/HEL-1699/concertino-servers/backend.pid` was `dbf3060d...` before and after my selftest runs. The selftest copies the script into a `git init` repo under `mktemp -d`, and its own final check also passed.

**CI script checks (fresh, all rc=0):**
- `check:ci-sbt-guard` and its selftest
- `selftest:cache-janitor`
- `check:cache-cleanup-pr` and its selftest
- `check:openspec`, `check:spec-structure`
- `check:ci-complete-needs`, `check:precommit-ci-parity`
- `check:repo-integrity`, `check:e2e-prod-build-projects`, `check:dependabot`
- `selftest:ci-sbt` (`all ci-sbt checks passed`)
- Prettier `--check` on every changed non-shell file: clean
- `action.yml` and `ci.yml` parse as YAML (actionlint is not installed)

**Driver constraint "no timeout raised".** No `timeout-minutes` line appears in the diff.

### Verdict: CONFIRM

### Non-blocking notes
- `files-modified.md` lists the executor-touched paths but not the planning artifacts in the diff (`.openspec.yaml`, `proposal.md`, `design.md`, `specs/*/spec.md`, `ticket.md`, `skeptic-design-*.md`). Under a strict reading of CON-260, the orchestrator may want to add them.
- In CI, the selftest leaves `sleep 20` stubs (from case 2's `start` and case 4) running for up to about 20 s after the step exits. They exit on their own and the runner reaps them; no action is needed.
- C1 is still owed at delivery: the PR body must say AC1's hit side is unproven at merge, and the hand-back needs at least 5 post-merge hit runs (tasks 4.3 and 5.1).
- No gate defect to record: no report I drilled into relied on mtime ordering.
