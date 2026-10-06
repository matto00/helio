## Evaluation Report — Cycle 7 (evaluation-4.md)

- **Reviewed head:** local `3a8a157de35a6a66e7da2c19eab0c8a096b60f62` (docs-only) on top of pushed `aa18aa24`.
- **Diff base:** resolved live as merge-base `1f35e5b4`. origin/main is now `e043566d` (HEL-1276); it touches no ci.yml, `e2e/` or `frontend/src` files.
- **CI:** read via `gh` only. Nothing was pushed, re-run, dispatched or cancelled.
- **PENDING-OWNER, not counted as defects:**
  - **C12:** the root cause of the sbt start hang.
  - **C9:** this branch's parallel-mode header on `e2e/hel519-recent-navigation.spec.ts`, a HEL-1298 spec. It stays as the status quo until ruled.

### Status of evaluation-3's change requests

| CR | Subject | Status |
|---|---|---|
| 1 | C6 pattern kill | **Resolved** |
| 2 | Wrong-process liveness / post-fork fail-fast | **Resolved** |
| 3 | C12 | PENDING-OWNER |
| 4 | C9 | PENDING-OWNER |
| 5 | tasks.md | **Resolved** |
| 6 | profile.md | **Partly resolved.** The "after" tables and counts were added; the stale text is still there (see Phase 1). |

**CR1 — C6 pattern kill.**
- `scripts/e2e-backend.sh` contains no `pkill`, `pgrep` or `killall`, and no restart path. Its only process operation is `kill -0 -- "-$pgid"` (L48).
- `KILL_SBT_SERVERS` is gone from ci.yml.

**CR2 — liveness and fail-fast.**
- `start` launches `setsid $SBT run` and records `$!` as the PGID.
- `wait` fails within one poll when no process in that group is alive, both before and after the fork.
- It fails loudly when the log has not reached compile/run by `STAGE_TIMEOUT` (120 s).

**CR5 — tasks.md.** 6.1–6.4 are ticked, and each matches the evidence:
- 6.1, 6.2 and 6.4: the ci.yml lines.
- 6.3: run 37392082526 ended with `ci-complete` = failure.
- 5.3 is ticked, and the "after" top-15 and counts now exist.
- 2.2 is correctly still `[ ]` for the final skeptic.

### My own reproduction of the guard's red

All of this ran against a real backend started through the script, on port 9627 only, under `nice -n 19`. Logs and PGID files are in the scratchpad (`hel1288-eval4/`).

| Case | Group observed | Action | `wait` result |
|---|---|---|---|
| Pre-fork | 992538: wrapper `bash …/sbt run` (PID = PGID = SID 992538) and launcher JVM 992578 | `kill -- -992538` about 3 s after start | `exit=1 elapsed=0s`, `sbt process group 992538 is gone before the fork`; no orphaned launcher left |
| Post-fork crash | PGID 993192 (launcher 993236, forked app 993395, listening on 9627) | Killed only forked app 993395 (the boot-crash shape) | sbt logged `nonzero exit code returned from runner: 143`, the whole group exited, then `exit=1 elapsed=0s`, `backend process group 993192 is gone after the fork` |
| Post-fork group kill | PGID 994413, healthy | `kill -- -994413` | `exit=1 elapsed=0s`, `… gone after the fork` |
| Hung stage | Stub `SBT_CMD` that prints `set current project` and then sleeps, `STAGE_TIMEOUT=5` | none | `exit=1 elapsed=6s`, `hung before the compile/run stage for 5s`; log dumped. Stub group 995079 then killed by `kill -- -<PGID>` |

- In cycle 6 the wrong-PID kill left an orphaned launcher. The process group now covers the whole tree that `sbt run` creates locally.
- In cycle 6 the post-fork case took the full timeout (46 s at `TOTAL_TIMEOUT=45`). It now fails in 0 s.

Cleanup: every group was killed by its exact PGID, with no orphaned `sbt-launch` left in this worktree. `sbt --client shutdown` was run as its own call and reported "no sbt server is running". Port 9627 is free and the worktree is clean.

### Phase 1: Spec Review — FAIL

The following were checked and hold:

- **ci.yml vs origin/main (`e043566d`):** every hunk is in the `e2e` job (L395–532; `e2e:` is at L393, `ci-complete:` at L544).
  - The HEL-1287 backend matrix, concurrency and timeouts are unchanged.
  - `ci-complete` still `needs: [frontend, backend, security, e2e]`.
  - The `--shard=${{ matrix.shard }}/${{ strategy.job-total }}` glob plus `testIgnore` is intact.
  - Between 21ddb3c5 and aa18aa24, ci.yml changed only by a comment and the removal of `KILL_SBT_SERVERS`.
- **Streak run 37423587074** (head aa18aa24, pull_request, merge ref 35fa9b9f): all three attempts concluded `success`. Times are leg execution in seconds:

  | Attempt | e2e legs 1–4 | ci-complete | security |
  |---|---|---|---|
  | 1 | 411/406/356/385 | 4 s | 62 s |
  | 2 | 312/388/355/379 | 4 s | 68 s |
  | 3 | 347/400/335/343 | 3 s | 74 s |

  - These match profile.md.
  - Each attempt's log compared against main 37337348981 gives **46/46 keys equal, 0 mismatches**, with exactly 10 focus lines.
  - The per-leg counts are 46/46/41/44 tests at 2 workers.
  - Every leg logged `backend healthy after 14–53s` from the new wait.
- **"After" tables:** I reproduced them exactly from the logs of 37419215755 attempt 3.
  - `scripts/e2e-profile.mjs list` gives 177 tests, 37 files and 1499.0 s, and its top 15 is identical to profile.md.
  - The leg-4 step times match the jobs API: containers 20, Java/sbt setup and cache 10, npm 9+17, browsers 37, backend health 53, Vite 2, suite 233, leg total 403.
- **Counts:** 149 → 175 (branch) → 177 on the merge ref, from HEL-1275's 2 tests. Spec files 36 → 37. This is correct.
- **sbt hang account:** honest. It says what was observed and states plainly that the root cause was not established or reproduced. It lists what the evidence excludes (HEL-1287's cache and build) and says the guard does not depend on the cause. The C12 ruling remains PENDING-OWNER.
- **hel1260, hel910 and HEL-1294's files:** no diff against the merge-base.

**Issue — stale and contradictory text remains in profile.md.** This is the unaddressed part of evaluation-3 CR6, and the orchestrator's check 4 asks for it explicitly.

1. **L21 ("Guard split evidence")** still says "Fix (local, unpushed) … Proven so far ONLY by a local run … Task 3.1 stays open until a PR CI log re-proves it after CI resumes." Task 3.1 is `[x]`. It has been re-proven on CI in 37382909964, 37396677223, 37401930670, 37411985775, 37419215755 and 37423587074, which the same file reports further down.
2. **L125**, under the 21ddb3c5 "After" table, says "The restart path of the new backend wait did not trigger (no warning logged observed in the runs' pass)." This is garbled and describes a restart path that no longer exists as of aa18aa24.
3. **L37**, in the historical PR-runs section, reads "Target (<= 6.5 min, 3 consecutive green on final head) is NOT yet demonstrated." It is historical, but it is unlabelled and now contradicts the two later 3-green streaks.

### Phase 2: Code Review — PASS

Gates I ran myself on this head:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `bash -n scripts/e2e-backend.sh` | OK |

No `frontend/**` or `backend/**` files changed, so Jest, the frontend build and `sbt testFull` are not triggered.

`scripts/e2e-backend.sh` review:
- **C6 is now honoured:** processes are selected only by the exact PGID recorded at launch.
- **setsid PGID:** `setsid` runs in a backgrounded subshell child, which is not a process-group leader. So setsid does not fork, `$!` is the session/group leader, and the locally observed PID equals PGID equals SID.
- **Liveness and hang check:** the liveness check covers the whole local tree. The hung-stage check dumps the log.
- **Comment accuracy:** the header comment states the thin-client caveat accurately.

No issues.

### Phase 3: UI Review — N/A

No trigger path changed.

### Overall: FAIL

This is a doc-only finding. The code, the CI evidence and the guard behaviour all pass.

### Change Requests

1. **`openspec/changes/halve-e2e-ci-job-time/profile.md`:**
   - **L21:** replace "Fix (local, unpushed) … Task 3.1 stays open until a PR CI log re-proves it after CI resumes." with the CI re-proof run ids (for example: "re-proven on CI, 46/46, in 37382909964 … 37423587074").
   - **L125:** delete the sentence about the "restart path", or replace it with "every leg's backend wait logged `backend healthy after N s`".
   - **L37:** prefix with "(at the time, superseded by the final streaks below)" or remove it.

### Non-blocking Suggestions

- **Source of the "after" tables:** taking them from 21ddb3c5 (run 37419215755 attempt 3) is acceptable. Between 21ddb3c5 and aa18aa24 the only changes to specs, config and CI are `scripts/e2e-backend.sh` and the removed env line. The final streak's backend-wait step times (14–53 s) fall in the same range as the 53 s in the table.
  - The final-head streak's top 15 (attempt 3) is shaped similarly (state-surface 222.6 s, focus 116.9 s, hel1028 92.1 s), with per-file noise of about ±30 s.
  - If you touch profile.md anyway, re-deriving both "after" tables from 37423587074 would make them cite the exact final head.
- **Hung-stage failure:** `wait` leaves the hung group running. That is harmless on an ephemeral runner. Optionally add a `kill -- -$pgid` before `die` in the hung-stage branch, using the exact recorded handle.

### Critical Path (final cycle: CYCLE 7 = EXECUTION_CYCLES 7)

- Only the three profile.md text edits above stand between this head and a PASS. Each is a one-line doc change and needs no CI run, because no code is touched.
- Two owner rulings remain and are outside the evaluator's authority:
  - **C12:** accept the fail-fast guard without a root cause.
  - **C9:** keep or revert the hel519 parallel-mode header.
- **Recommendation for the human:** have the three lines fixed in a docs-only commit, take a fresh evaluator pass (expected PASS), then rule on C9 and C12 before the final skeptic, as C13 already sequences.
