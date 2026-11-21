## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: bd10d1767eb04e9467428155ed99c92554a01f11 (base 16a6042d6, resolved live). Commits: 17919c4d7 (red e2e probe),
bd10d1767 (implementation).

Fresh gate runs (evaluator, in WORKTREE_PATH, nice -n 19, jest 3 workers, Playwright 2 workers):
- `npm run lint`: clean. `npm run format:check`: clean. `npm --prefix frontend run typecheck`: clean.
- `npm test`: root 70 suites / 617 tests passed; frontend 892 suites / 10,432 tests passed (exit 0).
- `npm --prefix frontend run build`: succeeded.
- `e2e/hel1683-regex-main-thread.spec.ts` (full file, lane DB helio_hel1697, backend started fresh by this evaluator with
  ANTHROPIC_API_KEY empty): 2 passed. Long-cell probe longest task 0.0 ms, one `POST .../draft-preview` request. Users
  removed by global teardown (lane DB holds only the system user afterwards).
- `git diff 16a6042d6...HEAD -- shared-test-fixtures`: empty. The parity corpus is unchanged.

Independent red verification, done in a throwaway detached worktree (removed afterwards, no straggler):
- The two new Jest files from HEAD run against 17919c4d7 (no implementation): 7 failed / 4 passed. This matches red-run.md
  (3 regexInputCost declines + 4 regexWorkModel). The 4 that pass are the controls that should pass.
- Mutation `quadratic: 0` at HEAD: 2 failed (`(a*)b` model value and the `(a*)b` 1000x500 decline). This matches
  mutations-jest.md M3.
- The e2e red is committed on its own (17919c4d7, 3816 ms task, no draft-preview) and it goes green with the
  implementation. Verdict on the executor's note: the red evidence is adequate. The pre-commit hook makes a red Jest
  commit impossible without `--no-verify`, so a reproduced red run is the right substitute, and I reproduced it.

### Phase 1: Spec Review — FAIL
- AC item 1 (decided, implemented, red-first long-task probe): PASS. The predicted-work budget is chosen and the Worker
  option is rejected with reasons (design D1). The e2e probe was committed red.
- AC items 3-4: PASS. javaRegex.ts is 201 lines. The class parser moved verbatim to javaRegexClass.ts (I compared the
  diff body; it is unchanged apart from Prettier re-wrapping the `parseClass` signature). Item 4: the stale "~165 ms"
  text is replaced, the overrun locator is filtered on `OVERRUN_PATTERN`, and the live branch asserts both `out` cells
  are `—`.
- AC "parity corpus unchanged": PASS (empty diff).
- Item 2 decision recorded: PASS (design D2, evidence item2-decision.md).
- Constraints: `CONSTRAINTS: []`, nothing to check.
- Issue (design D4 divergence): design D4 says the new long-cell probe "accepts either server outcome (live rows or the
  time-budget error) as the existing probe does". The existing probe asserts `live.or(budgetError)` is visible
  (e2e/hel1683-regex-main-thread.spec.ts:187-190). The new test (lines 220-254) only sleeps 4 s and counts draft-preview
  requests. It never checks that the user sees a server outcome. A regression where the step stays blank or shows an
  error after the request would still pass. -> CR1.

### Phase 2: Code Review — FAIL
- Canonical code-quality and file budgets: PASS (javaRegex 201, javaRegexClass 129, javaRegexCost 154, stringOps 162
  lines).
- Wiring: PASS. `declinesInput` runs after `problems` and before `apply` (evaluateStep.ts:66-67). `clientEvaluable` is
  unchanged, so the parity `clientEvaluable` assertions are unaffected. `regexInputCost` is not part of an exhaustive
  switch or a user-copy map (grep). `draftStepView.ts:116` routes every `needsServer` to the server result.
- Model: PASS against D1. F = paths x altsWeight with a wide atom weighing `max(1, min)`. m = max over wide atoms with
  `hasNext` of paths x tail (javaRegexCost.ts:142-153). The per-cell cost and the early exit match design
  (stringOps.ts:104-114). `work` is cached with the compiled RegExp.
- Calibration: the table has 133 rows and covers every pattern design D1 lists, plus the two Rule N edges. Max ratio is
  2.957 ns/unit, so the 6e6 budget is about 17.7 ms. The cited code comment matches (stringOps.ts:95-101).
- sessionStateAllowlist.ts: correct and necessary. `sessionResetGuard.test.ts` enforces "every module-level mutable
  identifier is allowlisted" and "every allowlist entry names a real declaration" (lines 123-149). Moving
  `ESCAPED_META`/`SIMPLE_ESCAPES` would fail both tests without the id update. The reasons are unchanged and still
  true (constant lookup tables).
- Tests meaningful: one test is vacuous. `regexInputCost.test.ts:41-44` "skips null cells and sums the UTF-16 length of
  the rest" passes on the unmodified tree (it was among the 4 that passed in my red run). Its frame (`null`, `5`) is
  nowhere near the budget, so it pins neither null-skipping nor UTF-16 length. -> CR2.
- Nit: stringOps.ts:15 adds a second import from `"../value"` (`import type { Frame }`) next to the existing line 14.
  Fold it into the existing import as `type Frame`. Non-blocking.

### Phase 3: UI Review — PASS
- Happy path: the client control evaluates (no draft-preview request). The declined steps go to the draft preview. No
  long tasks in any window (0.0 ms in all four windows).
- No failures or console-driven assertion failures in the spec run. The overrun error state renders (overrun locator
  matched).
- The change has no visual surface (no new copy, components or styles). Breakpoint and accessibility checks are not
  affected: the existing `Pattern` textbox is the only interactive element involved.

### Overall: FAIL

### Change Requests
1. In `e2e/hel1683-regex-main-thread.spec.ts`, long-cell test (lines ~238-254): after the request assertion, assert that
   the server's outcome for the step is visible, as design D4 requires and as the HEL-1683 probe does at lines 182-190.
   Either `rows.getByText("400 rows")` (live) or the exact time-budget step error filtered on `LONG_PROBE_PATTERN` must
   be visible (`.or(...).first()`, `toBeVisible({ timeout: 30_000 })`), with `rows` being the `Rows after step 1`
   region. Run the full spec file against the lane DB and record which branch was taken.
2. In `frontend/src/features/pipelines/evaluator/regexInputCost.test.ts:41-44`, make the null/UTF-16 test discriminating
   or delete it:
   - null-skip: a frame whose non-null cells are just under the budget, plus many `null`/absent cells, stays `ok`.
   - UTF-16: an astral-character cell whose UTF-16 length crosses the budget while its code-point count does not is
     `needsServer`/`regexInputCost`.
   Each case must fail under the matching mutation (count nulls as `"null"`; use `[...s].length`). Record the two
   mutation results in evidence/mutations-jest.md.

### Non-blocking Suggestions
- Flagged for the skeptic and the human: the budget's real threshold is much lower than the design's "long cells"
  framing suggests. I ran `evaluateStep` against HEAD over 1,000 rows of realistic prose cells (an order line with
  numbers, a date, `$129.99`, `ABC-77`). `(\d+\.\d+)`, `([A-Z]+)-(\d+)` and `^(.*)$` all decline to the server once
  cells reach 80 characters, yet the browser runs them in 0.1-0.2 ms. The 40-character cells stay client-side. Any
  pattern with a wide quantifier followed by more pattern (m >= 1) declines at about 77 characters x 1,000 sample rows.
  `(.*)x` is the case where the model is right: 46 ms at 300 characters. This matches D1 as written, and the design
  accepts it ("conservative ... same rows, server latency"). But design.md Risks and the PR body should state the real
  threshold (about 77 characters per cell at 1,000 rows for m >= 1) rather than "long cells", so the owner can judge
  the latency trade-off. The probe was a temporary test in the scratch worktree, not committed.
- stringOps.ts:15: merge the duplicate `"../value"` import.
