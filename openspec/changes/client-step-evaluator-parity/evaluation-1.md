## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `d2081b3c7a9962ecd602403af3f4f0b5e4a4e86f`. The diff base was resolved live to `83cbfc0223ec64a1ea060cbe5110ca03e9b0d617`.

### Fresh gate runs (evaluator's own, in WORKTREE_PATH)

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm --prefix frontend run typecheck` | exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `npm test` (2 workers, nice 19) | 524/524 root, 8322/8322 frontend, exit 0 |
| `sbt testOnly PipelineStepParitySpec ComputeExpressionFunctionsSeamSpec` | 670 succeeded, 0 failed |
| `npm run check:scala-quality` | clean |
| Full `sbt testFull` | not re-run. The executor's run shows 8822 passed, 0 failed (`scratch/HEL-1581/sbt-testFull.txt`). The only backend additions are test files, and the targeted spec was re-run fresh above. |

### Independent verification of the orchestrator's points

- **C1/C5 (oracle).** `ParityRunner.run` drives every step vector and walk vector through `InProcessPipelineEngine.executeTree`, which runs `requiredConfigProblems` before evaluate and honours `enabled` and `position`. Config decoding goes through the real `PipelineStepConfigCodec.decode`. `PARITY_REGEN` is never set in `.github/**` (grep finds no hits). With the flag set, the spec only fills in a missing expectation and asserts every expectation that is present.
  - My own mutation: I hand-edited two expectations in a scratch copy. One changed an `{"$int": 5}` to the double `5.0` in `window.json`. The other swapped two rows of the sort spike trap. I then ran with `PARITY_REGEN=1`. Both tests went red (664 passed, 2 failed), and the files were **not** rewritten.
  - Evidence: `.concertino/runs/HEL-1581/evidence/eval1-scala-handedit-regen.txt`.
- **Decision 4 mutations (re-run as my own variants on a scratch copy).**
  - Control: green (741 tests).
  - `round` via `Math.round`: red, 5 tests.
  - `cast integer` via `Number(s)`: red, 3 tests.
  - `clientEvaluable` forced to `ok`: red, 40 tests.
  - Evidence: `.concertino/runs/HEL-1581/evidence/eval1-mutation-sample.txt`. The executor's 19 recorded mutations, including its Scala check-1 mutation, are consistent with these.
- **Executor deviations from the design text:**
  - *Unknown field gives a per-row null.* The oracle is right: `ComputeStep.requiredConfigProblems` only parses, so a reference to a missing field is `EvaluationError.UnknownField` for that row. However, design.md still says the opposite (see Change Request 4).
  - *Unknown function declines.* This follows the design (Decision 1 compute row and check 5). Scala gives `scalaError` and the vectors record it. OK.
  - *Walk-vector block shape (`removed`, `notRun`).* This is justified: the engine reports only the first lane violation, and the oracle must not run AI steps. It is not reflected in design.md (Change Request 4).
  - *HashMap order reproduction.* Required, because Scala row order *is* group order. It is covered by vectors with up to 295 groups, and the executor's mutation 09 shows that first-seen order goes red. OK.
- **Known gaps (manifest `notes`).**
  - The Long beyond 2^53 gap was accepted by the design.
  - The Unicode-version gap and the 32-bit full-hash-collision gap are negligible.
  - The **window TimSort gap** and the **integer-like rename-key gap** are parity holes on configs the client accepts. They are not acceptable documented gaps (Change Requests 1 and 2).
- **Latency.** I re-ran the benchmark against a fresh `tsc` build of this commit. At 1,000 rows: median 0.36 ms, p95 0.74 ms, max 1.88 ms. At 10,000 rows the median is 6.3 ms. This matches `measurements.md` and is well inside the 50 ms budget.
- **C2.** No file outside `frontend/src/features/pipelines/evaluator/` imports the evaluator. The only other frontend change is a README paragraph.

### Phase 1: Spec Review — FAIL

Issues:

1. **The spec SHALL is violated for accepted configs.** Spec requirement "Client evaluation matches the server engine" says that for every configuration the client accepts, the rows and their order match. C3 and Decision 1 forbid approximating an in-scope feature: port it faithfully, or escalate if JavaScript cannot express it.
   - The manifest note on `window` `orderBy` records a divergence the executor knew about. This is an approximation that was neither ported nor escalated. JavaScript can express Java's TimSort.
   - **My probe:** I ran Java `Arrays.sort`, the TimSort that Scala's `Seq.sorted` uses, against V8's `Array.prototype.sort`, using `WindowStep.compareValues`'s comparator. The comparator is numeric when both values parse and `String.compareTo` otherwise, with an index tie-break. The test column was 70% integer strings and 30% strings like `"12 kg"`/`"7x"`.
     - Results over 10 seeds each: 0/10 orders diverge at 20 and 31 rows; 9/10 diverge at 32; 10/10 diverge at 40, 64, 200 and 1,000.
     - At 1,000 rows, 1 seed in 10 makes **Java throw `IllegalArgumentException: Comparison method violates its general contract!`**. The server fails that step, while the client shows rows.
   - The preview frame is up to 1,000 rows, so 32 or more rows per partition is the normal case, not an edge case.
   - Evidence: `.concertino/runs/HEL-1581/evidence/eval1-timsort-probe.txt`.
2. **The integer-like rename-key gap is the same class of problem (manifest note 6).**
   - A `rename` with at most 4 entries folds in JSON insertion order on the JVM. A JS object puts integer-like keys first.
   - So a chain (`{"b": "2", "2": "c"}`-style) or two sources mapping to the same target diverges silently on a config the client accepts.
   - This is detectable at the config level and should be declined, not documented.
3. **design.md does not reflect the final behaviour** (see Phase 2 / Change Request 4).

All acceptance-criteria items are otherwise addressed: the 23 kinds, `clientEvaluable` reasons, failable checks 1-5, the incremental walk with HEL-970 rejoin, latency recorded, and the required trap, regex and walk vectors present. No scope creep. CONSTRAINTS C1, C2, C4 and C5 are honoured. C3 is not (items 1 and 2).

### Phase 2: Code Review — FAIL

Issues:

- `frontend/src/features/pipelines/evaluator/evaluatePipeline.test.ts:161-178`: the test "a parentless step with an unknown root reads the first root, **as the engine does**" asserts an engine behaviour that the engine does not have.
  - In `executeTree`, `parentKey` resolves to `RootKey("nope")`, which is never in `evaluatedIds`. The run therefore fails with `LaneReferenceError("Cyclic or unresolved lane reference …")` (`InProcessPipelineEngine.scala`, `loop`).
  - The client returns `ok` rows instead. This is a Jest-only parity claim with no oracle vector behind it, which C1 rules out.
- `backend/src/test/scala/com/helio/domain/engine/ParityStepBuilder.scala:61-62`: `minimalConfig` is unused (dead code, CONTRIBUTING).
- The gates are green, and the canonical code-quality and DESIGN mechanical rules raise nothing else (DESIGN does not apply, since there is no rendered UI). Error handling, type safety and the tests are otherwise solid:
  - the two-way class comparator on both sides;
  - the decline-before-problems-before-evaluate ordering mirrors `evalOneStep`;
  - every error outcome is checked as non-`internal`.

### Phase 3: UI Review — N/A

No UI surface. The only `frontend/**` changes are the unimported evaluator module, its tests and a README paragraph (C2 confirmed by grep). No servers were started.

### Overall: FAIL

### Change Requests

1. **Window `orderBy` must reproduce Java TimSort, or decline.** Affected sites: `steps/window.ts:142` and `steps/windowRolling.ts:94`, both `[...group].sort(rowOrdering(...))`.
   - Replace `Array.prototype.sort` with a faithful port of `java.util.TimSort` (as reached by `Arrays.sort(T[], Comparator)`): `MIN_MERGE = 32`, `minRunLength`, `countRunAndMakeAscending`, binary insertion sort, `mergeCollapse`/`mergeForceCollapse`, `gallopLeft`/`gallopRight` with `MIN_GALLOP = 7`, and `mergeLo`/`mergeHi`.
   - The port must include the `"Comparison method violates its general contract!"` throws, surfaced as a step `error`.
   - Add oracle-filled `window.json` vectors:
     - a 40-row and a 64-row single partition with a mixed numeric/text `orderBy` column (e.g. `"12 kg"`, `"7x"` among integer strings), for `row_number` and one rolling function;
     - a larger case that makes the JVM throw (expect `{error: true}`). Use the seeds in `eval1-timsort-probe.txt` to find one.
   - Remove manifest note 5 (`manifest.json:220`).
   - If you would rather decline than port, that is a design change (a new decline reason and data-dependent declining). Escalate it; do not decide it unilaterally.
2. **Decline order-dependent `rename` configs that JavaScript cannot reproduce.** Location: `steps/rowOps.ts:25-35`, `renameHandler`. Add `declines` for the case where:
   - `renames` has at most 4 entries,
   - at least one key is an integer-like JS array index, and
   - the fold is order-dependent (some `to` equals another entry's `from`, or two entries share a `to`).

   Use an existing reason only if one fits truthfully. Otherwise escalate the new reason name, because design Decision 2 fixes the reason set. Add `clientDeclines` vectors with oracle `scalaRows`, and update manifest note 6 (`manifest.json:221`) to say the case is declined.
3. **Fix the unknown-root walk behaviour or the claim.** Location: `evaluatePipeline.test.ts:161-178`. Either:
   - (preferred) make `evaluatePipeline` mark a parentless step whose `rootId` is not among `rootFrames` as `error`, with its dependents `blocked`, like the other run-wide failures in Decision 4. Then add a `pipelines.json` vector (`laneError` + `removed` + `framesWithout`) so the oracle backs it; or
   - delete the test and its "as the engine does" claim, and record the divergence in the manifest notes.
4. **Amend design.md to match what was built.** The oracle-backed findings are currently only in tasks.md's Implementation notes.
   - Decision 1 compute row (`design.md:86`) and the Decision 4 trap list (`design.md:329`): an unknown `$field` is a per-row `null`, not a step error.
   - Decision 4 walk-vector shape (`design.md:259-262`): add `{laneError, removed, framesWithout}` and `{notRun, framesWithout}`.
   - Decision 4: state that a vector's `client` `rows: "scala"` placeholder is filled by regeneration.
   - Risks: list the known gaps that remain after Change Requests 1-3.
5. **Remove the unused `ParityStepBuilder.minimalConfig`** (`ParityStepBuilder.scala:61-62`).

### Non-blocking Suggestions

- `PipelineStepParitySpec.scala`, `checkWalkVector`: on a `LaneViolation`, assert that the message names one of the `removed` ids. For `notRun`, assert that every listed id is an enabled AI kind. This keeps either block from quietly excluding a non-violating or non-AI step from the full-tree oracle run.
- `steps/registry.ts:23`: add a one-line justification on the `no-explicit-any` disable, or type the table as `StepHandler<never>` with a cast at dispatch.
- `ParityCorpus.scala:59,92`: `java.lang.Double.*` inline is tolerated (the check is clean, and there are 17 precedents). An `import java.lang.{Double => JDouble}` alias would read better.
