## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD b895d955cf68b4c7c850ec1258deb1f348ea59b0 against live base b2da43a3d02ba1b84eb8296b9bd9ed742623a353 (resolve-review-base.sh).

### Phase 1: Spec Review — PASS
- Premise refutation verified: `.concertino/runs/HEL-1836/evidence/premise-validation.md` (verdict material-drift; `(x)` bound 2L vs exact L comes from the one-run bound, not surrogates). `events.jsonl` line 2 records `escalation.answered proceed-with-restated-scope` (answer_source human). Line 20 records `escalation.answered accept-as-accepted-risk` (human, chat) for the executor's group-J escalation (line 18). Line 19 is an `answer_discarded` for that same id, and line 20 is the answer that counts.
- AC1 (red first): I copied the new `regexUnanchoredScan.test.ts` into a detached worktree at main. There, 4 of 20 tests fail: the three worst-row zero-`codePointAt` tests (received 3,999,000 / 4,000,000 / 3,999,000 reads) and the stage-1-skip test (received 501). This matches `red-run.txt`. The red run is recorded as a .txt in the implementation commit, not in a separate earlier commit, because the pre-commit hook refuses red commits. The commit message says so, and C12 allows "commit (or record)". The red-first test is a structural proxy (counted code-point reads), not a timing test. I accept that as the deterministic form.
- AC2: groups A-I have no row over 20 ms on the change. My parse of the raw runs: H-new max 19.37 and worst unanchored 13.86; I-new 17.74; D control 18.6. Group A's larger `ms@4e6` values are extrapolations on per-call-overhead frames, excluded by the HEL-1807 method note. Group D's 151.7 is the m-flag measurement-only row. E's reported 19.0 is the script's worst over all variants, and the shipped variant measures 13.15. The surrogate-free cyr `(x)` shapes were added (group J "(x) on cyr + none"). Group J has 10 rows over 20 ms in run 2 and 18 in run 3, with a maximum of 24.35 ms. All are covered by the owner's accepted-risk ruling and listed in calibration.md. There are zero DECISION-DIFF, COST-DIFF or MISMATCH lines in any raw file.
- AC3: `e2e-green-run.txt` shows 6/6 passed with long tasks of 0.0 ms. Commit b895d955c touches only openspec files, so the code under test is identical to HEAD.
- AC4 (PR scope note): the orchestrator owns this. The wording is supplied in calibration.md and tasks 3.5.
- REGEX_WORK_BUDGET is still 4_000_000 (regexInputCost.ts:13, not in the diff). No parity-corpus file is in the diff.
- No scope creep. The only file outside evaluator/ is the allowlist entry, and it is required (see Phase 2).

### Phase 2: Code Review — PASS
Gates, run fresh in WORKTREE_PATH after `npm ci`:
- lint 0
- format:check 0
- typecheck 0
- `npm test`: root 683/683 and frontend 10867/10867
- `npm --prefix frontend run build` 0

Independent verification:
- **Charge identity and true bound.** I wrote a separate jest spot-check in a scratch HEAD worktree that imports main's `regexInputCost.ts` verbatim next to the shipped one. It covers 14 compiled patterns, including anchored, astral, negated, U+FFFF-straddling and surrogate-range classes, across 42,000 random cells over an alphabet with lone high/low, reversed and valid pairs. Results:
  - The shipped `cellWork` equals main's on every cell.
  - Shipped `cellWorkBound` >= exact and <= main's bound on every cell.
  - Across 560 frames, `workExceedsBudget` equals main's and equals `exactSum > budget` (50 of the 560 frames decide true).
  - The executor's (c) guard also passes.
- **Bound argument checked by hand.**
  - Unanchored `cellWorkBound = boundAt(unitLength)`, where `unitLength` is the exact `len`. The runs sum to at most `len`, so this is a true upper bound.
  - The new stage-1 order (`lengthBound`, then `cellWorkBound`) returns false only when the exact sum is at most the budget. Otherwise it scans exactly, so the decision is unchanged.
- **Mutations re-run in a scratch HEAD worktree** (three regex spec files):
  - Base: 77/77.
  - M5 (table range end exclusive): 12 failed.
  - M8 (D2 pre-check deleted): 1 failed.
  - Novel M10 (a low-low pair read as a pair, `c <= 0xdfff`): 11 failed.
  - Novel M11 (final run flush removed): 23 failed.
- **Allowlist.** Removing the `regexInputCost.ts#bmpTables` entry turns `sessionResetGuard.test.ts` red (1 failed). The WeakMap keyed by compiled `chars` holds only 64 KiB membership tables and no row data, so the entry is justified.
- Both scratch worktrees were removed afterwards.

Code-quality notes: the files are within budget (241 / 343 lines), there are no dead imports, and the doc comments state the true-upper-bound reasoning. One readability nit is listed below as non-blocking.

### Phase 3: UI Review — PASS
This is non-UI evaluator logic. Per the orchestrator brief, the UI check is the prod-build e2e. `e2e-green-run.txt` shows `hel1683-regex-main-thread.spec.ts` 6/6 passed with longest long task 0.0 ms. The source is byte-identical between the run commit and HEAD. I did not re-run it because I found no reason to doubt it.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- regexInputCost.ts:82: `const units = LONE_SURROGATE_UNITS;` is also used for a valid pair. A pair is 2 units because it is two code units, not because of the lone-surrogate constant. If `LONE_SURROGATE_UNITS` is ever retuned, pairs would silently be charged the new value, which diverges from main and from `anchoredCellWork`. Suggest `const units = pair ? 2 : LONE_SURROGATE_UNITS;`. This is behavior-identical today.
- calibration.md, group E: say that 19.0 is the script's worst over all variants and that the shipped variant measures 13.2.
