## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `39ad31aeb1d04ea49aa77af202664413d2da1b7e`. The review base was resolved live with `resolve-review-base.sh` and came out as `590474dcd`. The four commits are, in order: calibration `55349e05d`, red tests `d3fb4618f`, implementation `bd1c9412c`, records `39ad31aeb`. Every gate below was re-run by the evaluator. Scratch output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1807/eval1-*`. The worktree's `git status` was clean after every temporary edit.

### Phase 1: Spec Review — PASS
Issues: none

- **AC1, calibration tables committed.** `calibration.md` and `calibrate-anchored.mjs` are committed in `55349e05d`, and the shipped-code rerun is in `bd1c9412c`. I re-ran all six groups on the shipped modules with `nice -n 19`. Each group took 0-23 s.
  - No `MISMATCH`, `REJECTED`, `ACCEPTED RISK` or `DEFECT` line appeared.
  - Worst row per group: A 7.8 ms, B 9.2 ms, C 10.0 ms (the r=16 class-width row), D 18.5 ms (the unanchored HEL-1697 control `(.{16})x` on Cyrillic; the executor recorded 18.5), F 0.7 ms.
  - Group E (decision scan), shipped `workExceedsBudget` plus `exec`:
    - Maximum 13.10 ms, matching the recorded 13.05 ms.
    - The two-byte worst case, `^([а-я]*)x` on `ж...` + `!!!!!!`: 12.59 ms at 1,000 x 2,000 and 13.10 ms at 20,000 x 100.
    - The AC frame, `^(.*)$` at 1,000 x 500: 0.22 ms.
  - Partly anchored rows (`^(.*)x|y`, `^a*b|c`, `^(a*)b|(c)`) stay `anchored=n` with per-position costs of about 5e8. The multiline rows are measurement only. The controls reproduce HEL-1697: `a*b` at 0.517 ns/unit.
- **AC2, a test that fails first.**
  - `red-run.txt` was committed in `d3fb4618f` with no implementation files in that commit. In it the AC test `evaluates ^(.*)$ over 1,000 rows of 500-character cells on the client` fails for real, not only through a type error in a sibling suite.
  - I reproduced the red myself: I temporarily checked out the base `regexInputCost.ts` and `javaRegexCost.ts`, the AC test failed (1 failed), and I restored both files (`git status` clean). It is green on HEAD.
  - `red-run-e2e.txt` records the e2e anchored case failing on the old model because a draft-preview request was made.
- **AC3, the HEL-1697 adversarial shapes.** The non-anchored path is byte-identical:
  - `perPositionWork` is the old `cellWork` body, renamed.
  - The non-anchored `cellWorkBound` is unchanged.
  - Every existing HEL-1697 test in `regexInputCost.test.ts`, `regexCellWork.test.ts`, `regexWorkModel.test.ts` and `javaRegex.test.ts` is unchanged and green.
  - The anchored forms of every HEL-1697 shape (groups A-C) stay at or under 20 ms in my rerun.
- **Tasks and scope.** All tasks are ticked and match the diff. The change is frontend only, with no migration. No file belonging to HEL-1803 or HEL-1806 is touched.
- **Spec delta.** It matches the implemented charge: one attempt per cell, a `min` with the per-position charge, and partly anchored patterns keep the per-position charge.
- **CONSTRAINTS (workflow-state.md).**
  - C1 is honoured: `anchoredCellWork` returns `Math.min(attempt, perPosition)`, the early return only fires when `attempt <= f x A x text.length`, which is at most the per-position charge, and the budget is unchanged.
  - C2 is honoured: the read-counter tests bound the reads to `R0 + 1` code points per cell, and the decision-scan rows stay at or under 13.1 ms.

### Phase 2: Code Review — PASS
Issues: none blocking

Gates, all re-run:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (3 workers, root plus frontend) | 71 suites / 621 tests and 911 suites / 10,558 tests, all passed |
| `npm --prefix frontend run build` | exit 0 |
| Targeted Jest files `javaRegex`, `regexCellWork`, `regexInputCost`, `regexWorkModel`, `pipelineStepParity` (full files) | 5 suites, 798 tests, passed |

- **Parity corpus.** `git diff --stat` of `shared-test-fixtures` between the live base and HEAD is empty.
- **Mutations, re-run independently.** I applied each mutation, ran the three regex test files, and restored with `git checkout`. `git status` was clean after each one.
  - M4 (drop the `min`): 10 failed, the same 10 tests `mutations.txt` lists.
  - M6 (always run the full scan: early return removed): 2 failed, the two decision-scan tests.
  - M5 (eligibility counts any `^` in the sequence): 2 failed, `(a)^b` and `(.*)^(x)`.
- **Correctness.**
  - `startAnchored` only treats `^` (`kind: "anchor"`, `dollar: false`) as anchoring. A quantified `^` or a group is treated as not anchored, which is conservative.
  - The anchored bound uses `L = 2 x text.length` in both terms. That only loosens an upper bound, so the exact scan still decides.
  - The read-counter tests spy on `String.prototype.codePointAt`, which counts what the real code path reads and does not depend on timing.
- **Type safety.** The `codePointAt(i)!` non-null assertion repeats the existing loop's established pattern, and the index is always in range.
- **File size.** `regexInputCost.ts` is 141 lines and `javaRegexCost.ts` is 210.

### Phase 3: UI Review — PASS
Issues: none

The diff changes evaluator logic only. No markup, styles or components change.

- **Servers.** Started with `start-servers.sh` on 7239/10146, with `DATABASE_URL` set to the lane DB `helio_hel1807` (Flyway log line confirms that database) and `ANTHROPIC_API_KEY` exported empty. `assert-phase.sh servers` passed. Both were stopped with `stop-servers.sh` afterwards.
- **Full e2e.** `npx playwright test e2e/hel1683-regex-main-thread.spec.ts --workers=2 --project=dev`: 3 passed.
  - The anchored test made no draft-preview request.
  - The longest main-thread task was 0.0 ms, meaning no long task of 50 ms or more was observed.
  - All 12 out cells held the whole 10,000-character cell.
  - The two existing HEL-1683/HEL-1697 tests still decline to the server.
  - The 3 throwaway users were deleted.
- **Console.** I re-ran the anchored test alone with `--trace on` and read its trace. There were no page errors. There were two console resource errors, both pre-existing app behaviour unrelated to this diff: `401 /api/auth/me` before login, and `404 /api/pipelines/:id/schedule` for a pipeline with no schedule.
- **Breakpoints and accessibility.** Neither applies: there is no layout or interactive-element change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `regexInputCost.test.ts:128` cites `openspec/changes/anchored-regex-cost-refinement/calibration.md`. The production comments in `javaRegexCost.ts` and `regexInputCost.ts` cite `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibration.md`. After the archive the test comment will point at a path that no longer exists, and the production cite assumes the archive happens on 2026-11-21. Re-check both at archive time.
- `anchoredCellWork` repeats the unit-counting loop of `perPositionWork` (`regexInputCost.ts:70-101`). The design asked for one pass with an early return, so the duplication is justified for speed. A shared code-point/units helper would remove about 6 repeated lines without adding a callback to the hot path.
- `e2e/support/db.cjs` needs the JDBC URL to carry a user (`?user=...`). A bare `jdbc:postgresql://localhost:5432/helio_hel1807`, the form the lane brief gives, makes the backend fail at startup with "no PostgreSQL user name specified". This is a lane-brief detail, not a code issue.
