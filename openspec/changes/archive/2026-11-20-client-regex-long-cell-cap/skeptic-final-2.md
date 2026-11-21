## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 60b2404dbd239dcf4b2431e99c7cf4b3ce6f0588. Base resolved live with resolve-review-base.sh (main, origin): 16a6042d6. Three-dot diff.

### What I verified (with evidence)

**CR1, round 1 (probe headroom): resolved.**
- The new commit 60b2404db adds `cellWorkBound` and `workExceedsBudget` (regexInputCost.ts:62-85). stringOps.ts `overBudget` now calls `workExceedsBudget`. The per-character `cellWork` scan runs only when the summed closed-form bound is over the budget.
- Upper-bound proof, checked by reading the code:
  - In `cellWork`, `len` counts a surrogate pair as 2 (2 UTF-16 units), an unpaired surrogate as `LONE_SURROGATE_UNITS` = 2 (1 UTF-16 unit), and anything else as 1. So `len` <= `text.length` when the cell has no unpaired surrogate, and `len` <= 2·`text.length` when it has one. That is exactly the `L` the bound uses.
  - `/[\ud800-\udfff]/u` matches only unpaired surrogates under `u`. This agrees with the pairing logic in `cellWork`, which walks by code point.
  - Per run, `g(R) = R·A·min(R,W)` has a nondecreasing `g(R)/R`, so it is superadditive: the sum over runs is at most `g(sum R)`, which is at most `g(L)`. `m·R²` is superadditive too.
  - Every constant is nonnegative and finite: `A` >= 1 (paths), `W` >= 1 and finite (a non-wide atom's `max` is finite), `m` >= 0, and `f` ∈ {1, 1.75, 2} (javaRegexCost.ts:138-144).
  - All values are integers or quarter-integers far below 2^51, so the arithmetic is exact and summation order cannot flip a boundary case.
  - Empty cells give bound 0 and work 0. Null cells are skipped on both paths, as before.
- Property check (my own, outside the executor's tests). Script: /home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic-final-2/prop.cjs. Output: /home/matt/Development/helio/.concertino/scratch/HEL-1697/skeptic-final-2/prop-output.txt.
  - It compiles the real modules with tsc into scratch and covers 20 accepted patterns, including `f`=1.75, `A`=3 and 4, and `m`=1.
  - Cells mix ASCII, digits, Cyrillic, astral pairs, lone high and low surrogates, and empty strings.
  - Frames are scaled by repetition to land near the budget.
  - Result: 129,705 cell checks with 0 bound violations, and 4,000 frames (3,495 within ±10 % of the budget) with 0 decision mismatches against the exact summed `cellWork`.
  - The exact-at-budget pin still holds: `(\d+)` over 1,000 × 2,000 sums to exactly 4,000,000, which does not decline. Adding one digit declines.
- The e2e probe, re-run by me: 5 full-file runs of e2e/hel1683-regex-main-thread.spec.ts (dev project, 2 workers, nice 19) against fresh lane servers (helio_hel1697, ANTHROPIC_API_KEY empty).
  - All 5 runs passed 2/2.
  - The long-cell probe's longest long task was 0.0 ms in all 5 runs, and a draft-preview POST was made each time.
  - Server outcome was the time-budget error each time.
  - The HEL-1683 probe, control and overrun tasks were also 0.0 ms.
  - This meets CR1's bar (at least 5 runs at no more than 50 ms). `LONG_TASK_BOUND_MS` is unchanged.
- Mutation evidence: mutations-jest.md F1-F3 report 5, 8 and 4 failing tests. I did not reproduce them, because I am read-only on code. They are consistent with the tests:
  - F3 would break the `cellWorkBound("a\ud800")` = 8 assertion.
  - F1 would break the ordinary-text cases, where the bound is over the budget but the exact work is not.

**CR2, round 1 (decision-scan cost as C1 risk): resolved.**
- regex-work-calibration.md has a "Final-gate round 1" section with the worst-case scan (`(x)` over 1,000 × 4,000, about 21 ms) and the fast-path residual.
- pr-body-notes.md line 25 lists the scan in the C1 accepted-risk list, along with `(.{8})(.{8})x` on Cyrillic at 23.5 ms.
- fast-path-measure.txt matches: on the probe frame the saved `(x)` step costs 0.02 ms on the fast path versus 6.15 ms for the full scan.

**Gates (my own runs at HEAD):**
- `npm run typecheck` (tsc --noEmit): exit 0.
- `npm run build`: exit 0, and the PWA files were generated.
- eslint `--max-warnings 0` on the evaluator directory, src/shared/session and the e2e spec: exit 0.
- jest (3 workers) on src/features/pipelines/evaluator and src/shared/session: 17 suites, 947 tests passed. This includes the parity corpus.
- `git diff 16a6042d6...HEAD --stat -- shared-test-fixtures`: empty (AC3).
- javaRegex.ts is 203 lines, under the ~250 budget (AC2, item 3).
- AC1 and the item-4 spec tidy were traced in round 1 and are unchanged by this commit, which touches only regexInputCost.ts, stringOps.ts and regexCellWork.test.ts in code.

**Hygiene:**
- The worktree is clean after the build.
- The lane DB holds only system@helio.internal after the e2e runs, because the registry teardown deleted every registered user.
- Servers were stopped with stop-servers.sh.

**UI judgment:** not applicable. The change has no visual surface: it touches evaluator logic, an allowlist id move and an e2e spec. The MCP browser was not used.

**Gate defect check (CON-160):** no evidence directory used here discloses unsound mtimes, and no claim rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- `overBudget` now converts every non-null cell to a string before the bound pass, where the old code stopped converting early. This is O(rows) cheap work at a 10,000-row maximum and changes no decision.
- Follow-up candidates from round 1 still stand: the saved-step re-walk inside the input handler, and the dev-build preview-table render cost (`useScrollEdges.ts`).
