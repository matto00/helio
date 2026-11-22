## Evaluation Report — Cycle 4 (evaluation-2.md)

**Reviewed head:** `0246006654d51c03b41cf59391fee9b43fd14c99` (PR #1231).

**Review base:** resolved live with `resolve-review-base.sh`, exit 0: `590474dcd1122e6625d3ddc7bc387599b028b3a3`.

**Scope.** This report reviews what changed since my cycle-1 PASS at `39ad31aeb`:

- the cycle-2 staged anchored decision bound in `regexInputCost.ts`, and its tests;
- calibration groups G and H;
- mutation M7;
- the squash and the archive move;
- the main spec merge.

**How it was checked.** Every gate below was re-run by the evaluator, and nothing was committed. Scratch output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1807/eval2-*`.

**Untracked files.** Only `auditor-report.md` and `skeptic-final-4.md` (from the parallel skeptic) are untracked, plus this report.

### Phase 1: Spec Review — FAIL
Issues:

1. **The committed calibration script no longer runs from its committed location.** This breaks the AC "calibration tables for anchored shapes are committed" as a reproducible record.
   - `calibrate-anchored.mjs:17` resolves the repo root as `path.resolve(here, "../../..")`.
   - That was correct in `openspec/changes/<name>/`. Since the archive move it is one directory deeper, so it resolves to `<worktree>/openspec`.
   - Running `nice -n 19 node calibrate-anchored.mjs G` from the archive directory, as `calibration.md:3` instructs, crashes immediately: `ENOENT ... HEL-1807/openspec/frontend/src/features/pipelines/evaluator/javaRegex.ts`.
   - This is a delivery-step defect: the archive move is unreviewed code. The tables themselves are intact.

Everything else passes:

- **Model change.** The ticket's acceptance criteria and the standing constraints C1 and C2 still hold on the cycle-2 model change.
- **AC2 (the test fails first).** It is still red-first, from cycle 1.
- **Cycle-2 red evidence.** The cycle-2 red was committed in the same commit as its fix; the executor records this in its process note. The red is real: `red-run-cycle2.txt` shows 3,998,000 reads where 0 were expected, and my M7 run reproduces the same red.
- **Main spec.** `openspec/specs/pipeline-client-evaluator/spec.md` carries the delta exactly: the requirement text plus three scenarios.
- **Accepted-risk band.** The 20-50 ms band of group H, worst 36 ms, is recorded under owner ruling C2 of HEL-1697. Nothing is over 50 ms. The final-gate skeptic confirmed it in round 3.

### Phase 2: Code Review — PASS
Issues: none

**The staged bound is sound.**

- `workExceedsBudget` first checks the surrogate-free bound, which is unchanged from cycle 1.
- For anchored patterns it then checks `testedBound`. That is the same closed form at `L` = the cell's UTF-16 length, doubled only when the cell has an unpaired surrogate (HEL-1697's test).
- Both are true upper bounds of `cellWork`: the per-position term is HEL-1697's bound, and in the anchored term `L >= R0`.
- So returning `false` at either stage never changes a decision. It only skips the exact scan.
- The non-anchored path is behaviour-identical: `boundAt` with `anchored=false` is the old formula, with the same lone-surrogate test.

**Gates, all exit 0:**

| Gate | Result |
|---|---|
| `npm run lint` | pass |
| `npm run format:check` | pass |
| `npm run typecheck` | pass |
| `npm test`, 3 workers | root: 71 suites / 621 tests; frontend: 911 suites / 10,560 tests |
| `npm --prefix frontend run build` | pass |
| Full Jest files `javaRegex`, `regexCellWork`, `regexInputCost`, `regexWorkModel`, `pipelineStepParity` | 5 suites / 800 tests |

**Parity corpus.** `git diff --stat 590474dcd HEAD -- shared-test-fixtures` is empty.

**Mutations, run on this head.** Each was restored with `git checkout`, and `git status` was clean apart from the expected untracked files.

| Mutation | Result | Matches `mutations.txt` |
|---|---|---|
| M7 (drop the tested second bound) | 1 failed: `skips the exact scan when the tested bound already fits` | yes |
| M6 (always run the full scan) | 2 failed: both decision-scan read-count tests | yes |

**Calibration on the shipped code.** I ran these from a scratch copy of the script whose only change is the root line, because of the Phase 1 issue. `nice -n 19`, one process at a time.

| Group | Rows | Recorded | Worst measured (decision + exec) | Result |
|---|---|---|---|---|
| E | decision-scan rows | n/a | 18.37 ms (cycle 1: 13.1 ms) | at or under 20 ms. The rise is the second-stage surrogate test on the `^([а-я]*)x` two-byte row. |
| G | 85 rows | 19.2 ms | 19.2 ms | no accepted-risk rows |
| H | 249 rows | 161 accepted-risk rows, worst 36.0 ms | 165 accepted-risk rows, worst 36.5 ms (`^([^<64 ranges>]+)` on Cyrillic + high surrogate at the end, 20,000 x 95) | none over 50 ms; within run-to-run noise of the record |

### Phase 3: UI Review — PASS
Issues: none

**Servers.**

- Started with `start-servers.sh` on 7239/10146, against the lane DB `jdbc:postgresql://localhost:5432/helio_hel1807?user=matt`.
- `ANTHROPIC_API_KEY` was exported empty.
- `assert-phase.sh servers` returned PASS.
- Stopped with `stop-servers.sh`.

**E2E.** `npx playwright test e2e/hel1683-regex-main-thread.spec.ts --workers=2 --project=dev`: 3 of 3 passed.

- The anchored test made no draft-preview request.
- The longest long task in that test was 0.0 ms.
- The two HEL-1683/HEL-1697 tests still decline to the server.
- 3 throwaway users were deleted.

**No visual change.** The diff has no markup or style change, so the breakpoint and accessibility checks do not apply.

### Overall: FAIL

### Change Requests
1. `openspec/changes/archive/2026-11-21-anchored-regex-cost-refinement/calibrate-anchored.mjs:17`: make the root resolve correctly from the archive directory. Either change `path.resolve(here, "../../..")` to `path.resolve(here, "../../../..")`, or walk up from `here` until a directory containing `frontend/package.json` is found, which survives any future move.
   - Then run `nice -n 19 node calibrate-anchored.mjs F` from the archive directory and confirm it exits 0.
   - Re-run the root-dependent checks: lint, format and the OpenSpec hygiene hook on commit.
   - No calibration table needs to change. My scratch-copy run of groups E, G and H on this head reproduces the recorded numbers.

### Non-blocking Suggestions
- `calibration.md:3` lists the groups as `<A|B|C|D|E|F>`. The script now also has G and H; update the usage line.
- In the PR body, carry the reduced headroom stated in `calibration.md` ("Accepted risk"): about 1.4x against the 50 ms ruling on the group H shape.
