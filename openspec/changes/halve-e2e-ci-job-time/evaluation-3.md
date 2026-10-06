## Evaluation Report — Cycle 6 (evaluation-3.md)

**Reviewed head:** local `47425bfc46d8a33604246615e3318a4698ee05b1`. It is docs-only and sits on pushed `21ddb3c5`.

**Diff base:** resolved live as merge-base `1f35e5b4` (HEL-1287). Since then origin/main has advanced to `77bdaec8` (HEL-1275).

**CI handling:** CI was read via `gh` only. Nothing was pushed, re-run, dispatched or cancelled.

**Constraints:** C1–C12 from `tasks.md` / `workflow-state.md` were applied.

### Ground-truth checks requested by the orchestrator

1. **ci.yml vs main: PASS.**
   - Every hunk of `git diff 1f35e5b4...HEAD -- .github/workflows/ci.yml` lies inside the `e2e` job (L395–534). The `e2e` job starts at L393; `ci-complete` is at L546.
   - HEL-1287's backend matrix, `concurrency:` stanza and job timeouts are untouched. main's `77bdaec8` does not touch ci.yml.
   - `ci-complete` still has `needs: [frontend, backend, security, e2e]`.
   - The Playwright step is still `npx playwright test --shard=${{ matrix.shard }}/${{ strategy.job-total }}`, so the config glob and `testIgnore` are intact (HEL-951).
   - `max-parallel: 4`, `timeout-minutes: 18` and matrix `[1..4]` are present.
   - The diff adds no `actions/cache` step; the e2e job's only cache step is main's sbt cache, unchanged.
   - `playwright.config.ts` pins `workers: CI ? 2`. Its JSON reporter is CI-only, and `testIgnore` is untouched.
2. **Streak: PASS.** I checked run 37419215755 through the attempts API.
   - Head is `21ddb3c5` (pull_request event). All three attempts have conclusion `success`.
   - ci-complete was success in all three attempts (3/4/2 s), and so was security (77/76/51 s).
   - e2e leg execution times, legs 1–4:

     | Attempt | Leg 1 | Leg 2 | Leg 3 | Leg 4 | Slowest |
     |---|---|---|---|---|---|
     | 1 | 283 s | 370 s | 250 s | 405 s | 6.75 min |
     | 2 | 290 s | 339 s | 360 s | 423 s | 7.05 min |
     | 3 | 269 s | 412 s | 337 s | 403 s | 6.9 min |

     These match profile.md.
   - Per-view population: I ran my own comparison script on each attempt's log against main 37337348981. All three show **46/46 keys equal and 0 mismatches**, with exactly 10 `[HEL-520 …] view` lines.
   - Per-leg test counts were 46/46/41/44 at 2 workers each. No "restarting sbt once" warning appears in any attempt.
   - The run checked out `refs/remotes/pull/774/merge` (`95d93177`), which already includes main's HEL-1275 (2 `hel1275` tests). So the streak covers current main. It is also where the **177** comes from: the branch head alone lists **175** (`npx playwright test --list`).
3. **hel1260 / HEL-1294 / HEL-1298: PARTIAL.**
   - `git diff 1f35e5b4...HEAD` is empty for `e2e/hel1260-orphan-owner-repair.spec.ts` (HEL-1289's rewrite came in through the main merge). It is also empty for HEL-1294's files and for `e2e/hel910-pipeline-to-dashboard-flow.spec.ts`.
   - **`e2e/hel519-recent-navigation.spec.ts` is edited by this branch** (+6 lines: `test.describe.configure({ mode: "parallel" })`, added in 6b64a003). That file holds HEL-1298's `hel519:90`. The orchestrator's premise that "the diff vs main should show nothing for them" is false for this file. See Phase 1, issue 4.
4. **profile.md:** see Phase 1, issues 2 and 3.
5. **Tasks:** see Phase 1, issue 1. Task 2.2 is correctly still `[ ]`, pending the final skeptic.

### Phase 1: Spec Review — FAIL

The following still hold:
- The D3 split is in place: 18 + 10 cells, no beforeAll/afterAll, and per-cell assertions.
- The overlays recents replay is unchanged in sequence.
- The API-login root cause for the `/settings` 24-vs-25 count is documented with a probe.
  - `INTERACTIVE_SELECTOR` includes `tbody tr`.
  - The audit table shows a "Signed in" row only after a real `auth.login`.
  - The API login reproduces that row, and CI shows `/settings` back at 25/24 in every attempt.
- The D2 ledger is unchanged from cycle 1, where I verified it.
- The cancel proof holds: run 37392082526 (head 1bdbbbd8) has all e2e legs, backend and frontend `cancelled`, security `success`, and `ci-complete` = **failure**.

Issues:

1. **tasks.md does not match what was implemented.**
   - §6 tasks 6.1–6.4 are all `[ ]`, yet each is implemented and evidenced: `max-parallel: 4` and `timeout-minutes: 18` are in the ci.yml diff, the cancel proof is run 37392082526, and no cache step was added.
   - Task 5.3 is `[x]` ("Fill profile.md 'after' top-15 and counts"), but profile.md has no "after" top-15 and its own `## Pending` section still says the final "after" tables are needed.
2. **The profile does not meet the AC "before and after per-step timings, plus the top 15 slowest specs before and after" (C1).**
   - There is no "after" per-step table: containers, checkout, sbt cache, npm ci, browser install, backend health, Vite and suite per leg, for the final streak.
   - There is no "after" top-15 table. `scripts/e2e-profile.mjs json|list` over the streak's per-shard artifacts or logs would produce it.
   - Counts are stated three different ways: "175 -> same" in Pending, "175 tests" in the 4deb0242 section, and "177 tests" at 21ddb3c5. None of them says that 177 = 175 on the branch + 2 HEL-1275 tests from main via the PR merge ref.
3. **profile.md still contains stale, self-contradicting text.**
   - The title still says "interim — final 'after' pending CI".
   - "Guard split evidence" still says "Fix (local, unpushed) ... Task 3.1 stays open until a PR CI log re-proves it", but 3.1 is `[x]` and has since been re-proven on CI in 37382909964, 37396677223, 37401930670, 37411985775 and 37419215755.
   - The 21ddb3c5 section header is garbled: "177 tests: 46/46/41/44... per-leg 46/46/41/44".
4. **C9 needs a ruling before merge.** C9 says "never edit HEL-1298 specs (hel519:90, hel910:90)". This branch's diff vs main edits `e2e/hel519-recent-navigation.spec.ts`: it puts the file in parallel mode, and the +6 lines also shift `:84` to `:90`. HEL-1298's own `hel519:90` reference uses this branch's numbering.
   - The edit predates C9 (6b64a003, cycle 2). Whether C9 forbids it is a scope ruling for the orchestrator or owner, not for this evaluator.
   - The question matters because HEL-1298 is now In Progress on that same file, which means a likely merge conflict. HEL-1298 also blames the failure on CPU contention at 3–4 workers, and this branch's parallel mode is what spreads that file's tests across workers.
   - Possible outcomes: the ruling accepts the pre-existing edit, or the executor reverts the hel519 parallel-mode line and re-measures. Either way, record it in tasks.md.
5. **C12 is not honoured as written.**
   - C12 requires a probe-confirmed root cause of the backgrounded `sbt run` hang. profile.md states "Root cause NOT proven and NOT reproduced".
   - A mitigation shipped instead: restart once, and pkill on CI (see Phase 2).
   - Either produce the probe-confirmed cause or escalate. The probe would capture the thin-client server's state when the hang recurs, for example by forcing the thin-client path locally with the launcher CI uses, or by trying `-Dsbt.server.autostart`/no-client mode. Escalating would mean asking the owner to accept "mitigation without root cause" explicitly and recording that ruling. Without one or the other, C12 is unmet.

### Phase 2: Code Review — FAIL

**Gates I ran myself:**

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `bash -n scripts/e2e-backend.sh` | OK |
| `npx playwright test --list` | 175 tests |

No `frontend/**` or `backend/**` files changed, so Jest, the frontend build and `sbt testFull` are not triggered. shellcheck is not installed here.

**Local probe of `scripts/e2e-backend.sh` against a real backend:**
- Setup: port 9627, `nice -n 19`, log and pidfile under the scratchpad (`hel1288-eval3/`).
- Every process I started I stopped by exact PID: 886385/886499/886795 and 890274/890314/890625.
- `sbt --client shutdown` ran as its own call and reported "no sbt server is running". Port 9627 is free afterwards.

**Issues:**

1. **C6 violation: process kill by pattern.** `scripts/e2e-backend.sh:57`, used on CI because ci.yml sets `KILL_SBT_SERVERS: 1`:
   ```
   [ "${KILL_SBT_SERVERS:-}" = 1 ] && pkill -f 'sbt-launch|xsbt.boot|sbt.*server' 2>/dev/null
   ```
   This selects processes by command-line regex, not by an exact recorded handle. It is confined only by an env var and by the assumption that the runner hosts nothing else matching the regex. Nothing in the script proves that.

   Shown locally: at probe time `pgrep -f sbt-launch` matched **four other lanes' sbt JVMs**. Their cwd values were the worktrees for HEL-1300, HEL-1276 and HEL-1298, plus one in the helio root. That is exactly what this line would kill if the variable were ever set outside CI, because the script lives in `scripts/`, not in the workflow.
2. **`alive()` tracks the wrong process, and the restart path does not kill the real sbt.** This is the reason the pkill was needed.
   - `$!` (`:27`) is the PID of the `sbt` wrapper script.
   - Locally, `kill <recorded PID>` left the actual launcher JVM running (890314, reparented to PID 814). It went on to compile and logged `Helio backend listening on …:9627`.
   - Meanwhile `wait` had already reported `::error::backend: sbt process died before the backend started` within 1 s. On CI, the restart path (`:56`, `kill "$(cat "$PIDFILE")"` followed by `launch`) can therefore start a second sbt next to a surviving first one.
   - Suggested fix for issues 1 and 2 together: launch in its own session (`setsid nohup $SBT run … &`), record the session/process-group id, test liveness with `kill -0 -- -$PGID` (or `pgrep -s $SID`), and kill with `kill -- -$PGID`. All the observed processes stayed in one group: wrapper, launcher and forked app were all PGID 886383 or all PGID 890272.
   - Verify on CI that the thin-client server is in that group too. If it is not (it daemonizes with its own setsid), use sbt's own exact handle (`sbt --client shutdown` against that `backend/` build) rather than a regex. Alternatively, run sbt without the thin client so there is no detached server at all.
3. **The fail-fast wait does not fail fast when the backend dies after the fork.** This is the case the old comment cites: a boot crash like run 32902461344's missing env var.
   - Local repro: backend healthy, then I killed the forked app JVM.
   - sbt logged `[error] (Compile / run) nonzero exit code returned from runner: 143` and every process exited.
   - `TOTAL_TIMEOUT=45 scripts/e2e-backend.sh wait` then failed only at the timeout: `exit=1 elapsed=46s`, `did not become healthy within 45s`. On CI that is 300 s.
   - Cause: `:42-44` treat a dead client as non-fatal whenever the log contains `running (fork)`.
   - C12's "fail-fast health wait (PID liveness + log progress)" is therefore met only for pre-fork deaths. The script header says "failing FAST (and loudly) when the backend is dead", which is broader than what it does.
   - Fix: with the process group from issue 2, "no live process in the group and health down" means fail. Also treat `nonzero exit code returned from runner` in the log as fatal.
   - Add this post-fork case to the recorded red evidence. The current red in profile.md comes from stub shims only; C12 asks for a red against a deliberately killed backend.

**Checked and fine:**
- **Guard cells:** API register, API dashboard, then a real `POST /api/auth/login` with the cookie handed to the page. Theme comes from `addInitScript`.
- **`/settings` readiness:** the gate on 5 `main .sortable-th__btn` is web-first and present in both guards.
- **Focus guard:** it registers without a login (cookie only), but its `/settings` population equals main (34) in all three streak attempts, so the missing audit row is outside `FOCUSABLE_SELECTOR`.
- **Parallel-mode files:** unchanged since cycle 1, where I checked their isolation.

### Phase 3: UI Review — N/A

No UI trigger path changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`).

### Overall: FAIL

### Change Requests

1. **`scripts/e2e-backend.sh`: replace the pattern kill (C6).**
   - Remove `pkill -f 'sbt-launch|xsbt.boot|sbt.*server'` (L57) and the `KILL_SBT_SERVERS` variable in ci.yml.
   - Launch with `setsid` and record the group/session id in the pidfile.
   - Liveness and kill must use that exact handle: `kill -0 -- -$PGID` and `kill -- -$PGID`. Use `sbt --client shutdown` for the thin-client server if a CI probe shows it leaves the group.
   - Record in profile.md a CI or local probe showing which processes the handle covers, as a `ps -o pid,pgid,args` listing.
2. **`scripts/e2e-backend.sh`: fail fast on a post-fork death.**
   - When no process in the recorded group is alive and `/health` is down, call `die` immediately, whether or not the log contains `running (fork)`.
   - Also call `die` on `nonzero exit code returned from runner`.
   - Record the red against a really killed backend in profile.md, both before and after the fork.
3. **C12:** add the probe-confirmed root cause of the hang to profile.md, or escalate and record an explicit owner ruling that a restart-once mitigation without a root cause is accepted.
4. **C9 / `e2e/hel519-recent-navigation.spec.ts`:** get and record a ruling (orchestrator or owner) on whether this branch's pre-existing parallel-mode edit to a HEL-1298 spec stands. If it does not, revert those 6 lines and re-run the streak.
5. **tasks.md:**
   - Tick 6.1–6.4, citing the evidence (ci.yml lines, run 37392082526, no cache diff).
   - Un-tick 5.3 until issue 6 below is done, or do issue 6.
   - Keep 2.2 open for the final skeptic.
6. **profile.md:**
   - Add an "After" section from the final streak (37419215755). It needs a per-step timing table per leg (or for the slowest leg, as in the "before" table) and a top-15 spec table from the streak's `playwright-json-shard-*` artifacts or logs via `scripts/e2e-profile.mjs`.
   - Give before/after test counts as: 149 on main 37337348981, then 175 on the branch head, which became 177 in the PR merge ref once HEL-1275 added 2 tests.
   - Replace the "interim" title and the stale "Fix (local, unpushed) ... Task 3.1 stays open" text with the CI re-proof run ids.
   - Fix the garbled 21ddb3c5 header.
   - Remove or update the `## Pending` section so it lists only the driver's post-merge median and flake rate.

### Non-blocking Suggestions

- `e2e-backend.sh` `wait` greps the whole log each poll. That is fine at this size, but the stage check (`compiling|…`) would also match the hung log's earlier attempt, because `launch` truncates the log only at restart. It is OK as written; just keep the `: > "$LOG"` truncation.
- The slowest leg is 6.75–7.05 min across the streak, so attempt 2 (7.05 min) is above 7. The owner accepted the timing under C11 (median ~6.9). State the median of the final streak's slowest legs in the PR body: 6.9 min.

### Critical Path (final cycle: CYCLE 6 = EXECUTION_CYCLES 6)

The test-suite work is done and proven on CI:
- the guard split, with 46/46 per-view lines equal to main in all 3 streak attempts;
- the parallel-mode files;
- the 4-leg × 2-worker sharding, with three consecutive all-green attempts including ci-complete;
- the ci.yml scope (C4) and the HEL-951 contract.

What blocks a PASS is concentrated in the new `scripts/e2e-backend.sh` and in paperwork. In priority order:

1. **The C6 pattern kill.** Change Requests 1–2 rework the script to use a process-group handle. This fixes the pattern kill and the wrong-PID liveness and restart in one change, and Change Request 2 adds fail-fast on a post-fork death.
2. **C12 and C9 need explicit owner rulings.** C12: accept a mitigation without a root cause, or fund the probe. C9: does the pre-existing hel519 parallel-mode edit stand despite HEL-1298? I cannot decide either of these, and they should not be decided implicitly.
3. **The profile "after" section and tasks.md.** Change Requests 5–6 are doc-only.

**Recommendation for the human:** grant one more cycle limited to Change Requests 1, 2, 5 and 6, and rule on C9 and C12 directly. Alternatively, drop the restart/pkill path entirely and keep only the fail-fast detection; a loud early failure was the C12 requirement. That removes the C6 hazard with the smallest change. Any change to `e2e-backend.sh` needs one fresh CI run to show the backend step still passes, plus a fresh evaluator pass.
