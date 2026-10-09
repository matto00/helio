## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: b8dfdce3fcf5e068d80cda9fa95420da0f313e36 (`git rev-parse HEAD` in the worktree; equals PR #869 `headRefOid`).
Base: resolved live with `resolve-review-base.sh <wt> main origin` -> b0ff8570 (exit 0). The diff is `git diff b0ff8570...HEAD`.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/ci-sbt-diag-tidyups/HEL-1362`.

**Driver constraints (C1):** The `ci.yml` diff has 3 lines, all comment-only (lines 241-242 and 251). No cache key or path changed, the HEL-1299 restore/save split is untouched, and no `timeout-minutes` changed.

**Ticket items, each traced to the code:**

1. **Guard over logical lines.** `scripts/check-ci-sbt-no-pattern-kill.mjs` adds `logicalLines()`, which joins lines ending in `\`, `|`, `||` or `&&`. YAML `key: |` headers are excluded.
   - Red/green, run by me. I loaded the base guard (b0ff8570) and the new guard side by side on four split-pipeline inputs, including `x=$(ps -ef \` + `| grep sbt)`. The old guard reports 0 findings on every input; the new guard reports 1 on every input.
   - Local `node scripts/check-ci-sbt-no-pattern-kill.mjs`: `ok (4 files scanned)`, rc 0. Guard selftest: all ok, rc 0.
2. **Timing comment and evidence restated.** I re-derived the backend (0) time from job start to the "Compile and test" step start myself, using `gh run view --json jobs`:
   - Runs 37870529638, 37871617663, 37872469892 and 37874061808 took 83, 90, 73 and 77 s. These match the comment and the `ci-evidence.md` correction exactly.
   - HEAD run 37874966856 took 76 s.
   - The selftest step took 41, 46, 43, 41 and 45 s, which is consistent with the "41-46 s" in the comment.
3. **Capture-kind messages.** `ci_sbt_capture` now returns 0 (jcmd dump written), 2 (only SIGQUIT sent) or 1 (nothing). `ci-sbt.sh:67-72` and `e2e-backend.sh die` each `case` on all three.
   - Neither script uses `set -e` (only `set -u`), so the bare call followed by `case $?` is safe.
4. **Hard capture budget.** `_diag_timeout` now runs `timeout -k 1 (cap-1)`, so the kill grace is included in the cap. A candidate is skipped and logged when less than 3 s of budget is left. The post-SIGQUIT sleep only runs when at least 2 s are left. I walked the arithmetic: the ceiling is budget + <1 s, which comes from `SECONDS` truncation.
5. **Archived logs trimmed.** The two flaky-test logs (5,469,997 B) are removed; `ci-logs/` is now 156K. The positive-control log and `control-artifact/` are kept. The decision and the history location (d71f646cb) are recorded in `ci-evidence.md`'s correction section.
6. **Thin-client lever removed.** `--mode`, `E2E_SBT_SERVER_FLAG` and `_diag_socket_owner`/`active.json` are gone.
   - Grepping `.github`, `scripts` and `package.json` finds no remaining consumer.
   - The `mode=server` token is kept in log lines, so the main spec's "Mode is visible in the log" scenario still holds.
   - The spec delta updates "recorded sources only" to match.

**Hang-only paths are deliberately exercised (local and CI):**

- **Local `ci-sbt.selftest.mjs`** (nice 19, JDK 21): all 26 checks ok, rc 0. Case (h) measured 4.59 s against a 6 s budget.
- **Mutation, run by me.** I ran the new selftest against the base `scripts/lib/ci-sbt-diag.sh` (with the new ci-sbt.sh and e2e-backend.sh, copied to scratch). It went red on exactly the new cases, 4 FAILED:
  - (f): the old library says "thread dump captured" after SIGQUIT only.
  - (g): e2e reports no SIGQUIT message.
  - (h) budget: measured 10.60 s against 6 s, with 4 SIGQUITs and no "skipped" line.
  - So the new cases detect the old defects. The green run is 4.59-5.42 s; the red run is 10.6 s.
- **Coverage of each path:**
  - The deadline path with real jcmd is case (a): "Full thread dump" plus the `Hang.main` sleep frame.
  - SIGQUIT-only is covered for ci-sbt.sh (f) and for the e2e-backend.sh die path (g), using a PATH-shimmed failing jcmd.
  - The budget ceiling is covered by (h): 4 verified JVMs, a hanging jcmd, timing taken from outside the library, and the skip logged.
- **CI on HEAD, run 37874966856:** every check SUCCESS, including ci-complete.
  - backend (0), job 113641332986: every (a)-(h) line is `ok`; (h) measured 5.42 s against a 6 s budget; the log ends with `all ci-sbt checks passed`.
  - frontend, job 113641332594: guard `ok (4 files scanned)`, plus every split/YAML selftest line `ok` and `real tree is clean`.

**C3 (no pattern kills):** The new selftest code enumerates `/proc` stat and exe for the group it recorded itself. It signals only recorded PGIDs (`kill -KILL -- -gid`). The guard's real-tree scan is clean.

**UI:** None. No `frontend/**` change, so no design review is needed.

### Verdict: CONFIRM

### Non-blocking notes

- **Blank line inside a continuation.** `logicalLines` ends a continuation at a blank line. Bash accepts `ps -ef |`, then a blank line, then `grep sbt`, and the guard does not flag that input (measured: new guard 0 findings). It is a contrived spelling, so this note is not blocking.
- **Dangling log references.** `ci-evidence.md:65` and `:68` still name the two removed log files. The appended correction explains where they went, but readers of those earlier lines meet a dangling path first.
- **Timing margin ignores post-steps.** The "about 30 s to spare" figure leaves out post-step time after "Compile and test" (observed about 6-7 s on these runs). The real hang path is also bounded much earlier, by the 660 s in-step deadline plus about 30 s of capture and stop. So the margin is still comfortable.
- **Untracked evaluation report.** `openspec/changes/ci-sbt-diag-tidyups/evaluation-2.md` is untracked in the worktree (`git status`). The orchestrator should commit or persist it as intended.
- **Selftest length.** `scripts/ci-sbt.selftest.mjs` is about 282 lines, over the soft size budget. The evaluator already noted this.
