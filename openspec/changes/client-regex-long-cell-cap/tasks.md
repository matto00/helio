## Standing Constraints
- [C1] A finding that is only a constant-factor V8 slowdown staying under 50 ms per draft step at the budget is recorded in the PR as accepted risk, not a blocker; over 50 ms still blocks (owner ruling 2026-11-20).
- [C2] Design rounds: at most 2 more (rounds 7-8) after the owner's continue-model ruling; if both refute, escalate again (owner ruling 2026-11-20).

## Tasks

### Frontend
- [x] 1.1 Red first: add the e2e long-cell single-quantifier probe and the Jest decision tests (decline `(a*)b`,
  `(a{1000})b`, `(a{1000,})`; short-cell client-side; `(a+)`/`(\d+)` client-side; model values); run them on the unmodified tree, record the red run in
  `.concertino/runs/HEL-1697/evidence/red-run.md`, and COMMIT before any implementation
- [x] 1.2 Measure and record the calibration table (`.concertino/runs/HEL-1697/evidence/regex-work-calibration.md`)
- [x] 1.3 Add `regexWorkModel` (perStart F, quadratic m) to javaRegexCost.ts; return it from `compileJavaRegex` (cached)
- [x] 1.4 Add `regexInputCost` to `ClientDeclineReason`, `declinesInput` to `StepHandler`, call it in `evaluateStep`
- [x] 1.5 Implement `declinesInput` for stringops extractRegex with `REGEX_WORK_BUDGET` citing the calibration
- [x] 1.6 Split the class parser into `javaRegexClass.ts`; javaRegex.ts <= 250 lines, no test expectation changes
- [x] 1.7 Spec tidy in e2e/hel1683-regex-main-thread.spec.ts: header comment, overrun locator filter, live-branch
  empty `out` cells

### Tests
- [x] 2.1 Mutation checks: the decision tests go red with the budget check removed, with F forced to 1, and with m
  forced to 0; the e2e probe goes red with `declinesInput` disabled; record in evidence
- [x] 2.2 Full evaluator Jest files, parity test, typecheck, lint; `git diff main -- shared-test-fixtures` is empty
- [x] 2.3 Full e2e/hel1683-regex-main-thread.spec.ts run against the lane DB (both tests)
- [x] 2.4 Record the item-2 decision (no narrower Rule W) and its measurements for the PR body

### Cycle 2
- [x] 3.1 evaluation-1.md CR1: long-cell probe asserts the server outcome (live "400 rows" or the time-budget error
  filtered on its pattern); rerun the full spec file against the lane DB
- [x] 3.2 evaluation-1.md CR2: discriminating null-skip and UTF-16 tests, each red under its mutation
- [x] 3.3 Run-based cost (design D1 cycle-2 refinement): red tests first (ordinary-text scenario), then implement,
  re-calibrate, re-derive the budget, mutation (run decomposition replaced by whole-cell) goes red
- [x] 3.5 Calibration per D1 addendum (two-byte + lone-surrogate rows), budget from the max over all rows; keep the
  lone-surrogate charge (with a Jest decline test red at charge 1) only if uncharged lone rows exceed that max;
  anchor-eligibility Jest cases if the anchor refinement ships
- [x] 3.4 Remove the duplicate `../value` import in stringOps.ts
- [x] 3.6 Class width (design D1 addendum 2): `r > 64` declines as `unsafeRegex` (corpus max-r script); calibrated
  `classFactor` on W and m; Jest decline tests red under factor=1 and cap-removed mutations
- [x] 3.7 Final formula (design D1 addendum 3): factor and alternatives outside the per-run cap; short-run and
  multi-alternative calibration rows; Jest red tests under the old clip and factor-inside-F mutations
- [x] 3.8 Addendum 4: `A x len` scan charge; non-`U` multi-alternative calibration rows; Jest red test; budget
  >= 4.00e6 check recorded (escalate if not)
