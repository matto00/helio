## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 62ebdbc0ee9373c670d935dacf8b8c72241115e1. Base resolved live with `resolve-review-base.sh` (exit 0): da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/cache-e2e-npm-installs/HEL-1699`.
- **Diff read in full** (`git diff da39f0f14...HEAD`). It touches the action, ci.yml, cache-janitor (+ selftest), e2e-backend.sh, the new lane selftest, package.json, the e2e-prod-build.mjs header and e2e/README.md. There is no product code, schema or timeout change, so the driver constraint against raising timeouts holds. `files-modified.md` lists every path.

**AC1 (item 1, cache install), pre-merge plan**
- `.github/actions/e2e-setup/action.yml`:
  - The restore uses the exact key `e2e-node-modules-v1-<os>-<arch>-node<setup-node output>-<hashFiles(both lockfiles)>`, with no `restore-keys`.
  - Both `npm ci` steps are gated on `cache-hit != 'true'`.
  - The save step is guarded by four conditions: the input is `'true'`, the event is a push, the ref is `refs/heads/main`, and the restore missed. It saves with `cache-primary-key`.
- `ci.yml` `e2e` passes `save-node-modules-cache: ${{ matrix.shard == 1 }}`. The `e2e-prod-build` job (ci.yml:726) and `e2e-slow.yml` do not pass the input, so they default to `"false"` and only restore.
- No later step in the e2e jobs runs `npm ci` again (grep of ci.yml 620-760 and e2e-slow.yml).
- This matches `ci-actions-cache-budget`, which allows main-only saves from one job.
- The hit side cannot be shown before merge (C1, design D3). Tasks 4.3 and 5.1 correctly remain open as the delivery and post-merge obligations. AC1's "across 5 CI runs" is therefore owed post-merge by the orchestrator, as the plan says.
- Janitor: the `e2e-node-modules` family uses `keep: 1`. `npm run selftest:cache-janitor` passed (rc=0), including the new superseded / PR / near-miss case.

**AC2 (item 2, `npm run e2e:prod-build` in a lane)**
- I re-ran the README sequence myself at HEAD 62ebdbc0e, under the e2e lock, starting from the lane's `start-servers.sh` state (record pid 3975950). I did not rely on the executor's run, which predates the cycle-2 `bash "$0"` change. Results:
  - `stop-servers.sh` printed `STOPPED ports=7131,10038`, rc=0.
  - `lane-start` printed `lane-start pid=64425 record=.../.git/worktrees/HEL-1699/concertino-servers/backend.pid ... cors=http://localhost:7131` and `backend healthy after 6s`, rc=0. Group 64425 held the sbt launcher plus the forked backend JVM.
  - The backend log shows `CORS allowed origins: http://localhost:7131`.
  - `npm run e2e:prod-build` printed `3 passed (7.9s)` (prod-build-guard, hel1631 :183, hel1632 :260), rc=0.
  - The second `stop-servers.sh` returned rc=0. `ps -g 64425` was empty afterwards, and ports 7131 and 10038 were both free.
  - `start-servers.sh` reported READY for both servers, and `assert-phase.sh servers` printed `PASS servers`.
- The log is in my session scratchpad as `skeptic-seq.txt`. It is not in the worktree, so it was not persisted. The key lines are quoted above.
- `start` and `wait` are unchanged from the base. Only the `lane-start` branch and the default usage line were added. Inside `lane-start`, the refusal paths use only `kill -0`, so no new signalling path exists.

**Selftests and CI checks, run fresh by me**
- `bash scripts/e2e-backend-lane.selftest.sh` passed 40 of 40 sequential runs (nice 19), 13/13 checks each time. The last check confirms the real worktree `backend.pid` sha `09f0233b...` is unchanged, so C2 holds.
- These all returned rc=0:
  - `check:ci-sbt-guard` (6 files scanned) and its selftest
  - `selftest:ci-sbt`
  - `check:cache-cleanup-pr`
  - `check:ci-complete-needs`
  - `check:precommit-ci-parity`
  - `check:e2e-prod-build-projects`
- A PyYAML parse of action.yml and ci.yml succeeded. actionlint is not installed locally.

**UI step:** N/A, because nothing under `frontend/**` changed.

**Debugging law:** this is not a bug fix in code. The root cause of the slow install is recorded with evidence in design.md: in run 39711300255 the `~/.npm` cache hit and `npm ci` still took 424 s. The baseline in `.concertino/scratch/HEL-1699/baseline-npm-ci.txt` shows the 424 s rows.

### Verdict: CONFIRM

### Non-blocking notes
- `scripts/e2e-backend-lane.selftest.sh` case 4 relies on `wait` hitting the stage check (elapsed 1 s, `STAGE_TIMEOUT=1`) before the total timeout (`TOTAL_TIMEOUT=2`) with `POLL=1`. A one-second boundary crossing on a slow runner could make `elapsed` reach 2 first and trip "did not become healthy" instead, failing the grep. I saw 0 failures in 40 runs locally. Widening the gap (e.g. `TOTAL_TIMEOUT=10`, since the stub group is still alive at 1 s) would remove the timing dependence from a required CI job.
- About half the rows in `baseline-npm-ci.txt` are blank, with job ids but no step timings. The PR body should use the populated rows only.
- A lockfile-changing PR still runs `npm ci` under the unchanged 8-minute timeout. The PR body must say so (C1), as design.md plans.
