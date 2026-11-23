## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `d830500036645207bc4b23719bf545a36e09b066`, base `d3059b6114f7735e210a4a1675737585d8dae5c8` (resolve-review-base.sh).
Evaluator scratch: `/home/matt/Development/helio/.concertino/scratch/HEL-1823/eval/` and `.../eval-cal/`.

### Phase 1: Spec Review — PASS
- AC1 (failing-first test): reproduced independently. The base `regexInputCost.ts` with the new test file gives 2 failures, "BMP body" (3,997,000 reads) and "astral body" (1,999,000 reads), the same as `red-run.txt`. The red run was recorded as `.txt` evidence in a3affec3a, before the implementation commit d83050003. design D3 allows this.
- AC2 (decisions unchanged): the soundness argument holds.
  - `unitLength` gives exactly the `len` that `cellWork` sums. Pairing is the same as `codePointAt`; I checked lone high before a pair and a pair followed by a lone low.
  - `boundAt` is nondecreasing in `L` (a min of two nondecreasing terms), so `testedBound >= cellWork`. This includes the early return at line 93, which is at most `f*A*len <= perPosition bound`.
  - `lengthBound <= testedBound`, so the extra `lengthBound` stage only short-circuits a frame that `testedBound` would also reject.
  - Floating-point summation is monotone.
  - Calibration reproduced: group H has 0 MISMATCH/DECISION-DIFF. Group I joined before/after on (pattern, size, cost): 64/64 rows have identical costs.
- AC3 (e2e): see Phase 3. Not freshly verified.
- Tasks are all checked and match the diff. No scope creep. No API/schema impact. `skip_specs` is justified.
- CONSTRAINTS C1-C14: no violation found in the diff or the artifacts.

### Phase 2: Code Review — FAIL
Gates (fresh, in WORKTREE_PATH):
- lint, format:check, typecheck, `npm --prefix frontend run build`: pass.
- Root jest: 73/73 suites pass.
- Frontend jest, 3 shards x 3 workers: 920/920 suites, 10,609 tests pass. This was run twice: on the original node_modules, and again after `npm ci`. The orchestrator reported, and I confirmed, that `echarts-for-react` was 3.0.6 against `^3.1.0`; it is 3.1.0 after `npm ci`. Build passes after `npm ci` too.

Mutations re-run by the evaluator, all against the full `regexInputCost.test.ts`:
- pairs-as-lone: red, astral body.
- first-lone-only: red, property test plus "doubles an unpaired surrogate".
- `isWellFormed` gate forced true: red, 3 tests.
- Forced fallback (no native `isWellFormed`): green. This is correct: the fallback is decision-equivalent.
- Dropping the `lengthBound` stage: green. This is expected, because it is a performance guard only, justified in calibration.md. It is not pinned by any test; see Suggestions.

Issues:
1. **Test-suite runtime regression.** The new property test "decides exactly as the summed exact charge for cells mixing pairs and unpaired surrogates" (`frontend/src/features/pipelines/evaluator/regexInputCost.test.ts:254-289`) takes **194.5 s** by itself (jest `--json` durations, `eval/head-json.json`).
   - The whole file took 3.8 s on base (`eval/base-json.json`).
   - The default 5 s timeout does not catch it because the test is synchronous.
   - Cause: 5 patterns x 60 trials x 3 factors = 900 frames, each sized to about 4.0e6 work units. With short cells that is up to about 1e6 rows per frame, and each frame runs both `workExceedsBudget` and a full `cellWork` reduce.
   - Impact: this one file now dominates the frontend jest step (CONTRIBUTING.md "Local resource caps": about 40-49 s for the whole step) and every pre-commit hook run.

### Phase 3: UI Review — PASS (with an unverified item)
- This is a pure cost-function change with no rendered UI surface.
- The executor's e2e transcript (`e2e-green-run.txt`) shows the prod-build guard and the 3 long-task tests passing.
- **My fresh re-run could not be completed in a valid environment.** The driver's binding "start-servers.sh only" rule makes the backend accept only `http://localhost:7255`. `e2e-prod-build.mjs` needs that port free for `vite preview`. My attempt with the preview on 7256 failed all 3 tests at login with `CORS request rejected: invalid origin 'http://localhost:7256'`. That is environmental, not caused by the diff, and the run cleaned up its 3 throwaway users.
- The documented lane procedure (`scripts/e2e-backend.sh lane-start`, the header of `scripts/e2e-prod-build.mjs`) is outside my sanctioned server path, so I did not use it.
- Risk analysis: the anchored stage-2 path only gets cheaper or stays equal (calibration H/I reproduced: anchored worst 18.04 ms, before 34-36 ms; dense worst +0.37 ms). Even so, AC3 rests only on the executor's transcript until a fresh run happens.

Calibration claims spot-reproduced (`eval-cal/after-H.log`, `after-I.log`, `before-I.log`):
- Group H: 200 anchored rows, 0 over 20 ms, worst 18.04 ms. The ticket shape `^([^<64 ranges>]*)` at 1000x1997 is 16.3-17.4 ms; calibration.md records 16.4-17.2.
- Group I after: worst 17.61 ms (claimed 17.65). Before: 25 rows over 20 ms (claimed 21; noise), worst 35.3 ms.
- Group I worst slowdown vs main: +0.37 ms (claimed +0.43).

### Overall: FAIL

### Change Requests
1. `frontend/src/features/pipelines/evaluator/regexInputCost.test.ts:254-289`: bring the property test under about 2 s while keeping its mutation power. Re-run the "count only the first lone" mutation afterwards and confirm it still turns this test red; record it in mutations.txt. Two ways to do it:
   - Cap the rows: for example, compute `rows` from `REGEX_WORK_BUDGET * factor / each` but skip (or regenerate) any trial where `rows > 20_000`, so cells get longer instead of frames getting wider.
   - Or test the bound directly on fewer frames: cut the trial count (60 -> 10) and the factors to `[1.0]` plus an exact-boundary pair.
2. Before PASS, run AC3 fresh. Run `e2e/hel1683-regex-main-thread.spec.ts` via `npm run e2e:prod-build` with a backend whose CORS allows the preview port, using the repo's documented lane flow (`stop-servers.sh` -> `DEV_PORT=7255 BACKEND_PORT=10162 scripts/e2e-backend.sh lane-start` -> `DEV_PORT=7255 BACKEND_PORT=10162 npm run e2e:prod-build -- e2e/hel1683-regex-main-thread.spec.ts` -> `stop-servers.sh`). Do it on the fresh `npm ci` install, and save the transcript as evidence. The driver must sanction `lane-start`, since its constraint names `start-servers.sh` only.

### Non-blocking Suggestions
- The `lengthBound` stage (`regexInputCost.ts:170-172,195`) has no test that fails when it is removed. A `charCodeAt` spy (alongside `countReads`) on `^(\d+)` over long cells with a leading lone surrogate, asserting a read count bounded by the first run, would pin the 0.1 ms vs 5-8 ms behaviour calibration.md describes.
- calibration.md group D lists a 21.4 ms unanchored control row (unchanged code). It is worth a one-line confirmation that it sits in HEL-1697's existing accepted-risk list.
