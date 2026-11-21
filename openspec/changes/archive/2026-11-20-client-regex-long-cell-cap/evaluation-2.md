## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: e876c4c07ee9a49a4cd5924bc5f37d4c7a68b617. The base was resolved live (16a6042d6, three-dot). The cycle-2
delta reviewed is `bd10d1767..e876c4c07`, read against the revised design.md (cycle-2 refinement and D1 addenda 1-4),
tasks.md and the spec delta.

Fresh gate runs (evaluator, nice -n 19, jest 3 workers, Playwright 2 workers):
- lint, format:check and typecheck: clean.
- `npm test`: root 617 tests passed, frontend 10,448 tests passed (893 suites), exit 0.
- `npm --prefix frontend run build`: exit 0.
- `e2e/hel1683-regex-main-thread.spec.ts`, full file, run 3 times:
  - Setup: servers started fresh by this evaluator (backend PID started 17:23:01) on helio_hel1697, with
    ANTHROPIC_API_KEY empty.
  - Result: 2/2 passed each time.
  - Long-cell probe: server outcome "time-budget error" every time; longest task 64 / 73 / 56 ms (bound 100).
  - Cleanup: the lane DB holds only the system user afterwards.
- `git diff 16a6042d6...HEAD -- shared-test-fixtures`: empty. The parity corpus is unchanged, and the parity test passes
  inside the full suite.

### Phase 1: Spec Review — PASS
- evaluation-1 CR1 is resolved. The long-cell probe asserts `live.or(budgetError)` with the time-budget error filtered on
  `LONG_PROBE_PATTERN`, and checks `400 rows` on the live branch (e2e lines 254-269). This follows design D4 and the
  HEL-1683 probe.
- evaluation-1 CR2 is resolved. The null-skip test is sized at 3.998e6 with 1,000 null/absent cells, and the UTF-16 test
  uses 2,001 astral characters (4.002e6 by units vs 2.001e6 by code points). I mutated both myself in a throwaway
  worktree:
  - Counting a null as `"null"`: 1 failed (the null-skip test).
  - Measuring length in code points: 2 failed (the UTF-16 decision test and the `cellWork` surrogate test).
- The implementation matches design D1 addenda 3/4: `cost = f x (A x len + sum over U-runs (R x A x min(R, W) + m x R^2))`
  (regexInputCost.ts:31-52).
  - `f` is the factor of the widest atom.
  - `r > 64` is `unsafeRegex` at compile time (javaRegex.ts:196), so `clientEvaluable` sees it.
  - A lone surrogate counts 2 units.
  - `REGEX_WORK_BUDGET` is pinned at 4.00e6, as addendum 4 and C1 allow, because the derivation (3.99e6) fell below
    the `(\d+)` floor.
- The new spec scenario "Ordinary text stays client-side" is pinned by `regexInputCost.test.ts` ("ordinary text"
  describe).
- The anchor refinement was optional and is not shipped. The reason is recorded in regex-work-calibration.md ("Anchor
  refinement ... NOT shipped"), as design D1 requires.
- Tasks 3.1-3.8 are all marked done and match the diff.
- Standing constraints:
  - C1 is honored. The calibration file records every row over 20 ms at 4.00e6 (max 21.8 ms) as accepted risk, plus the
    64-alternative non-row.
  - C2 is a design-gate process constraint, not code.

### Phase 2: Code Review — PASS
- File budgets are within limits: regexInputCost.ts 52 lines, javaRegexCost.ts about 190, stringOps.ts 153,
  javaRegex.ts about 203.
- The cycle-1 nit is fixed: stringOps.ts now has one `"../value"` import.
- Modularity is good: the cost model is in its own module (`regexInputCost.ts`, `cellWork` + `REGEX_WORK_BUDGET`).
  stringOps keeps only the step loop with early exit, and there are no import cycles.
- Tests are meaningful:
  - mutations-jest.md lists 12 single mutations, each red.
  - I reproduced M9 and M10 (above).
  - I added one of my own: treating every character as inside U ("whole cell is one run") gave 7 failed (the run
    split, the scan-only cell, both ordinary-text cases, alternatives, the per-alternative scan and the 64-range
    frame).
- Calibration claims, spot-checked independently. Setup: shipped `compileJavaRegex` + `cellWork` in a throwaway
  worktree, 1,000 rows, best of 3, under a loaded machine (load avg 7.5).
  - 16 patterns x 7 cell shapes. Shapes include ASCII + em dash, Cyrillic, lone-high surrogates and digit/dot runs.
    Patterns include several not on the calibration list: `(.{8})(.{8})x`, `(\D{16})x`, `(.{16}|.{15}y)x`,
    `(\d+)\.(\d+)\.(\d+)x`, `(\S+)x` and `(\w{0,16})x`.
  - Max predicted step time at 4.00e6: 23.5 ms (`(.{8})(.{8})x` on Cyrillic). Everything else was at most 20.6 ms.
  - All rows are well under C1's 50 ms, so this is consistent with the recorded calibration.
- Readability (minor): `RegexWork`'s single-letter fields `A`/`W`/`m`/`f` mirror the design formula and are documented
  in the JSDoc (javaRegexCost.ts:146-160). Acceptable.

### Phase 3: UI Review — PASS
- The decline path works end to end. For the long-cell probe, the draft-preview request is made and the server's
  time-budget error is shown. In the HEL-1683 tests, the client control stays client-side and the probe and overrun
  patterns go to the server.
- No visual surface changed (no copy, components or styles), so breakpoints and accessibility are unaffected.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- **The long-cell probe now shows a 56-73 ms main-thread task** (3/3 runs). In cycle 1 the same flow measured 0.0 ms, in
  my run and in the executor's. It is within the test's 100 ms bound, but the headroom is only 1.4-1.8x, and a 2-3x
  slower CI runner could flake.
  - It is not the decline. In the running dev app I imported the evaluator and timed it in the browser on the same
    400 x 3,000 frame:
    - `evaluateStep` of `(a*)b`: 0.9 ms cold, 0.0 ms warm.
    - `(\w+)\b`: 0.3 ms.
    - Client-evaluated `(a+)`: 6.6 ms.
    - `JSON.stringify` of the frame: 2.6 ms.
  - The machine was loaded during these runs (load average 7.5 on 12 threads). The task is most likely environment
    load, or the server-path handling or rendering of the 1.2 MB frame. Neither is code this diff touches.
  - Worth watching on CI. If it recurs, attribute it before tightening anything. If it is the server-path frame
    handling, it is a follow-up candidate, not a defect of this change.
- Add `(.{8})(.{8})x` on Cyrillic (23.5 ms at 4.00e6 in my spot-check) to the C1 accepted-risk list in the PR body
  alongside the recorded rows. It is under 50 ms, so it is C1-accepted, not a blocker.
- As planned, the PR body should carry the ordinary-text thresholds from regex-work-calibration.md:
  - `(\d+\.\d+)` stays client-side up to about 950 characters per cell at 1,000 rows, `([A-Z]+)-(\d+)` about 550,
    `(\d+)` about 3,000.
  - `(.*)x` and `^(.*)$` decline from about 60 / 45 characters.
  - The anchor refinement is a follow-up candidate.
