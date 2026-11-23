## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 07a1180016b8032c9c16f2514aa8a8c0319cb776 (the change dir is untracked and has no commits).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/deflake-hel1820-e2e-specs/HEL-1826`.
- I read ticket.md, driver-constraints.md, proposal.md, design.md and tasks.md in full.
- Premise "787a283e9 is an ancestor of f1ceb2f3c": `git merge-base --is-ancestor 787a283e9 f1ceb2f3c` exits 0 (true).
- Premise "none of the three spec files changed since f1ceb2f3c": `git diff --stat f1ceb2f3c HEAD -- <the three specs>` is empty (true). Other
  e2e files did change (`e2e/support/userCleanup.ts`, `userCleanupRun.cjs` among 8 files), but the specs did not.
- Line citations are correct. hel1791:290 is the HEL-1804 test "owner: a status message and an alert message render in flow in the same live
  regions" (serial file: no parallel mode, shared `owner` state). hel1582:244 is the `for (const size of SIZES.slice(0, 2))` loop, with
  `test.setTimeout(300_000)`, `waitForTimeout(8_000)` per theme and an unbounded `waitForFunction(getAnimations every not running)`. hel1572:126
  is the type-style test, which has one-shot `fontFamily` reads and clicks Serif without waiting for `data-type-style="serif"` before it polls
  `/api/auth/me`. H1a-c, H2a-d and H3a-c each match a real read in the code. None of them is invented.
- AC coverage: AC1 (root cause with evidence) maps to tasks 2.2/3.2/4.2 and Decision 5's `root-cause.md`. AC2 (20x green, 2 workers, nice,
  under stress) maps to 2.4/3.4/4.4 and Decision 5. AC3 (fails under mutation) maps to 2.3/3.3/4.3. The ticket's "file it separately" and
  "goes on the lane flake list" are covered by Decisions 3 and 4. The driver's no-ticket-filing rule turns filing into a report to the
  orchestrator, which is consistent with the driver.
- Fix rules (Decision 2) forbid loosening assertions, adding retries, raising a timeout as the fix, and skip/fixme. App-side causes (H1b, H3b)
  are escalated, not patched. This keeps to the ticket's "without weakening its assertion" and "if in the app, file separately".
- Scope: e2e/ only. No API or schema change, so no contract delta is needed (`skip_specs` is justified). Sibling-lane files are excluded.
- I found no TODO/TBD placeholders and no contradiction between proposal, design and tasks.

### Verdict: CONFIRM

### Non-blocking notes
1. **Feasibility of a 20x full-file run of hel1582 under C5.** That file has 7 tests, one with `test.setTimeout(590_000)` (line 43) and others
   at 240 s and 300 s. Under 4-6x CPU throttling, a single full-file run may come close to, or exceed, the 600 s Bash timeout. Batches cannot
   be split smaller than one run. Before the 20x, the executor should time one full-file run (plain and stressed). If one run does not fit,
   it should run the file's tests as per-test invocations that together cover every test in the file, and state that it did so. It should
   not quietly fall back to the target test alone, and it should escalate if neither approach fits. Note this in the evidence.
2. **How stress is applied for the "20x under stress" runs.** Decision 1 commits probe code as `.txt`, not as a live spec. The design does not
   say how CDP throttling or the stall is injected into the 20x full-file runs (for example, a temporary, uncommitted fixture or init hook).
   Record that exact mechanism, and its diff, next to the stressed-run evidence, so the evaluator can check that the stress was really on.
   One way: a stressed run that logs the throttle rate it applied.
3. **Mutation of app behaviour.** AC3 will usually need a temporary edit to app code (for example, unmounting the live region, or reordering
   the preference writes). That is allowed only as an uncommitted, reverted mutation. The design says "with the mutation diff". Also confirm
   in the evidence that `git status` is clean of app files afterwards.
4. **T1 alert check.** `/\S/` accepts any text. If the probe shows that the alert can carry text from a different failure, a fix may tighten it
   to the routed message ("HEL1804 rejected step"). That is a strengthening, so Decision 2 allows it.
