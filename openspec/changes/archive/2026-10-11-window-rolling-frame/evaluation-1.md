## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `d1643d6fb5ae982f972b08070f0eb9b633019595` (base `e8161b17bdb969eae5b844f7cdd0b753ab1023ac`, resolved live via `resolve-review-base.sh`).
Evaluator evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1316/evidence/eval-1/`.

### Fresh gate runs (evaluator, in WORKTREE_PATH)

| Gate | Result | Evidence |
|---|---|---|
| `npm run lint` | exit 0 | (inline run) |
| `npm run format:check` | exit 0 | (inline run) |
| `npm test` (`nice -n 19`) | exit 0; frontend 508 suites / 5468 tests, helio-mcp 44 / 433 | `eval-1/npm-test.txt` |
| `npm --prefix frontend run build` | exit 0 | `eval-1/build.txt` |
| `npm --prefix frontend run typecheck` | exit 0 | (inline run) |
| `cd backend && sbt testFull` (`nice -n 19`) | exit 0; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`; `Tests: succeeded 6748, failed 0, canceled 4`; the four new specs ran (`WindowStepRollingSpec`, `WindowRollingValidationSpec`, `WindowRollingAnalyzeSpec`, `WindowRollingSeamSpec`) | `eval-1/testfull.txt` |
| `npm run check:scala-quality` | pass. It warns that `WindowStep.scala` is 448 lines; see CR 4 | (inline run) |

### Phase 1: Spec Review — FAIL

- AC1 (7-row moving average including partial frames): PASS. `WindowStepRollingSpec` "match the hand-computed 7-row fixture" asserts `1, 1.5, … 7`, and the spec delta documents the partial-frame behaviour.
- AC2 (partitioning respected): PASS. The rows and days partition tests use interleaved input. The live run also checked it (team a and team b frames kept apart).
- AC3 (apply/infer parity and step editor support): PASS on behaviour. `WindowRollingAnalyzeSpec` "type exactly what apply emits" runs all five functions through both analyze and apply. The editor works in the running app (see Phase 3).
- **Issue P1-1: task 4.9 is marked done but was not implemented as written.** Task 4.9 and design.md Decision 8 both say the seam server half "runs the pipeline end to end … and asserts the fixture outputs". The driver/owner also asked for "an end-to-end pipeline run producing correct values on a fixture with gaps". `WindowRollingSeamSpec` instead calls `GET /pipelines/:id/steps/:stepId/preview`. That is the preview path, not a run, and nothing is materialized. The spec builds a `PipelineRunService` and wires `PipelineRunSubmitRoutes`/`PipelineRunStatusRoutes` (`WindowRollingSeamSpec.scala:66-70, 86-88`) but never calls them, which is dead test wiring. `files-modified.md` says "end-to-end preview", so the deviation was known but the task box was still ticked. The behaviour is correct: I ran it for real in the live app (step → Output → `POST /api/pipelines/:id/run` → `GET /api/outputs/:id/rows`, `materialized: true`) and got `1, 6, 10, 6, 4, 9, 30, null(unparseable "nope"), 9(null v on 2026-01-07)`. The gap is the missing automated proof that the task, the design and the owner's request call for. See CR 1.
- **Issue P1-2: task 2.4 is only half done in the user-visible entry point.** `stepNarrowing.ts:121` now says "Window (rank / running / rolling)". However, the Add-step palette, which is the main way a user finds the op, is fed by the backend catalog. That still says `"Window (rank / running total)"` (`backend/src/main/scala/com/helio/services/pipelines/PipelineStepCatalogService.scala:71`), and its description is "Compute a windowed value, like a rank or running total, over ordered rows." (`WindowStep.scala:425`, `catalogDescription`). In the running app the palette shows "Window (rank / running total)" and the step card it creates shows "Window (rank / running / rolling)". The same op now has two labels, and the palette never mentions rolling frames. See CR 2.
- Scope: no creep. The `DateBucketStep.parseToUtcDate` visibility widening is planned (Decision 5).
- Regressions: none found. Legacy wire shape is pinned in `WindowRollingValidationSpec` "a legacy window config" and in the seam test "keeps the legacy wire shape for a non-rolling function". Characterization rows were updated only to drop `undefined`-valued keys, which C11 requires.
- API contracts: no `schemas/` file enumerates window functions (I checked, which matches design 9). MCP docs and the `RefinementEditShape` doc string are updated.
- Planning artifacts: the spec deltas match the implemented behaviour. tasks.md 4.9 does not (P1-1).
- CONSTRAINTS:
  - C1–C5, C11: honored. These were checked in code, in the tests, and live. Live checks: clearing frame size persists a config with no `frameSize` key, and analyze reports "requires 'frameSize'". Switching to a rolling function fills 7/rows. The persisted live body was exactly `{partitionBy, orderBy, function, field, outputColumn, frameSize, frameUnit}`.
  - C7: honored. No compute/ExpressionEvaluator changes, and `RefinementEditShape.scala` has exactly one hunk.
  - C8: partly honored. `VerifiedEmbeddedPostgres.start` is used, `[hel1468-guard]` is present, and there is no migration. **Inline FQNs violate C8** (CR 3).
  - C9: not applicable to this review.
  - C10: honored. The client seam asserts the `updatePipelineStep` call argument with an exact key set, following the `JoinConfig.seam.test.tsx` pattern accepted at the design gate.
  - **C6: not met** for 4.8–4.11 (see Phase 2 and CR 5).

### Phase 2: Code Review — FAIL

Gates are all green (table above). Findings:

1. **[mechanical] Inline FQNs, which CONTRIBUTING.md §Imports & Qualifiers (line 70) and C8 forbid:**
   - `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala:291` `java.math.BigDecimal.ZERO`
   - `WindowStep.scala:300` `new java.math.BigDecimal(v)`
   - `WindowStep.scala:308` `new java.math.BigDecimal(v)`
   - `backend/src/test/scala/com/helio/domain/engine/WindowRollingAnalyzeSpec.scala:38-39` `a[java.lang.Integer]` / `a[java.lang.Double]`

   `check:scala-quality` does not scan `java.math`/`java.lang`, so it passed. The written rule and C8 still apply.
2. **File-size budget crossed by additive growth.** `WindowStep.scala` grew from 293 to 448 lines. CONTRIBUTING.md:24 says: "If a file you're editing crosses ~400 lines, propose a split … rather than adding to it". The rolling algorithm (`computeRolling`, `numericValue`, `slideFrames`, about 90 lines) is a self-contained unit and can be extracted.
3. **Readability: mis-indented block.** `WindowStep.scala:214-230`: the new `else {` branch wraps the existing `val sorted … cfg.function match {…}` without re-indenting it, which leaves a stray `}` at line 230 at the wrong depth. The structure is hard to read.
4. **C6 red-first and mutation proof.**
   - The backend unit specs (4.1–4.7) were observed red first: `red-backend-unit.txt` shows 27 failed, and the later green runs pass. Accepted.
   - The executor states that `WindowRollingSeamSpec` (4.9), `WindowConfig.seam.test.tsx` (4.8/4.11) and the `WindowConfig.test.tsx` rolling cases (4.10) were written after the implementation. Ordering can't be fixed after the fact. The substitute C6 itself names is a mutation that turns each guard red, and that evidence is insufficient here. `mutation-usesField-red.txt` is a single line (`Tests: 2 failed, 1 passed, 3 total`). It does not say which mutation was applied, which tests failed, or what they failed on, so it does not prove anything about the 4.11 guard.
   - The seam spec and the 4.10 tests have no mutation proof at all. A seam test whose only evidence is "passes after the code" is exactly the evidence-shaped non-evidence C6 exists to prevent.
5. Correctness of the algorithm: reviewed and sound.
   - Ranges are non-decreasing in both modes, `lastPeer` gives same-date peers the same end, and the start pointer only moves forward. Deque eviction is correct because the deque holds only indices that have values. The `BigDecimal` sum avoids drift.
   - Days mode splits unparseable keys out before sorting.
   - Error order (field → frameSize → orderBy → enumProblems) matches the spec in `apply` and in `validateWindow`.
6. Type safety and security: no `any`, no new escape hatches. Input bounds are enforced at the write boundary, including the raw `7.5`/`5000000000` check.
7. Dead code:
   - The unused run-service wiring in the seam spec (P1-1).
   - `WindowStep.computeRolling` `cfg.frameSize.getOrElse(1)` is an unreachable fallback, because `rollingDraftProblems` already threw. This one is non-blocking.

### Phase 3: UI Review — PASS (with P1-2 recorded under Phase 1)

Run on ports 6748/9655 via `start-servers.sh` (`PASS servers`) with a throwaway user. Every row it created (user, data source, pipeline, output, rate-window row) was deleted afterwards by exact id. I stopped the servers I started, by exact PID.

- Happy path:
  - Add step → Window → partition `team`, order `date` asc, `rolling_sum`, field `v`, frame size 3, unit days, output `rolling_v`.
  - The persisted config was exactly the fixture shape.
  - Preview showed `1, 6, 10, 6, 4, 9, 30, —, 9`. A real run plus the materialized Output rows matched it.
- Unhappy path:
  - Clearing frame size persists a draft with no `frameSize` and shows "window function 'rolling_sum' requires 'frameSize'" inline. No blank screen.
  - The open preview's refetch got a 422, which is the expected response for an invalid draft and is surfaced inline.
- Console: no errors from this feature. Pre-login `/api/auth/me` 401s and the pre-existing `/schedule` 404 for a pipeline with no schedule are unrelated.
- Accessibility: "Frame size" is a `<label for>` plus a `spinbutton` with `min=1 max=1000`. "Frame unit" is the shared `Select` with `ariaLabel`, the same pattern as "Window function".
- DESIGN.md mechanical rules: the frame size input, frame unit select and window function select compute to identical height (32px), font (14px), background, border, radius (6px) and padding (12px). Labels use the shared `pipeline-detail-page__compute-label` (12px). Checked in both themes.
- Breakpoints:
  - At 1440, 1100 and 768 there is no overflow (controls are 766/766/694 px wide inside the card).
  - At 375 the step card clips about 27px on the right. That clipping is pre-existing and affects the existing "Window function" and "Output column" controls and the sort-key remove button the same way, so it was not introduced here.
- Screenshots (already in the durable run evidence dir):
  - `eval-1/window-editor-dark-1440.png` (taken at a 1280 viewport)
  - `eval-1/window-editor-light-1280.png`
  - `eval-1/window-editor-light-375.png`
- My Playwright snapshots were moved out of the main checkout's `.playwright-mcp/` into `eval-1/playwright-mcp/`.

### Overall: FAIL

### Change Requests

1. **Make the seam server half a real end-to-end run** (task 4.9, design Decision 8, the owner's request), in `backend/src/test/scala/com/helio/api/routes/pipelines/WindowRollingSeamSpec.scala`.
   - After creating the step and analyzing it, create an Output on the window step (`POST /pipelines/:id/outputs` with `nodeStepId`, or `OutputRepository`).
   - Submit a real run through the already-wired `PipelineRunSubmitRoutes` (`POST /pipelines/:id/run`) and wait for it to reach a terminal success via `PipelineRunStatusRoutes`.
   - Assert that the materialized rows for that Output (`node_snapshots` through the Output-rows read path) equal `expected`.
   - Keep the preview assertion if you want, but the run assertion is the required one.
   - Add at least one unparseable or null date row and one null `v` row to `shared-test-fixtures/window-rolling-seam.json` `input`/`expected`, so the gap fixture also exercises null handling through materialization. `expected` then needs nullable entries, and the client half is unaffected.
   - Either remove whatever wiring stays unused, or use it.
   - Update `files-modified.md` so it no longer says "preview".
2. **Update the catalog label and description the Add-step palette shows** so they mention rolling and match the step card.
   - `PipelineStepCatalogService.scala:71`: change `"window" -> "Window (rank / running total)"` to `"Window (rank / running / rolling)"`.
   - `WindowStep.scala:425` `catalogDescription`: mention rolling averages and other trailing frames, e.g. "Compute a windowed value, like a rank, running total or rolling average, over ordered rows."
   - Update any test pinning the old strings.
3. **Remove the inline FQNs** (CONTRIBUTING.md:70, C8).
   - `WindowStep.scala:291,300,308`: import `java.math.{BigDecimal => JBigDecimal}` at the top of the file and use `JBigDecimal.ZERO` / `new JBigDecimal(v)`.
   - `WindowRollingAnalyzeSpec.scala:38-39`: import `java.lang.{Double => JDouble, Integer => JInteger}` and use `a[JInteger]` / `a[JDouble]`.
4. **Extract the rolling algorithm out of `WindowStep.scala`** (CONTRIBUTING.md:24; the file crossed 400 lines by addition).
   - Move `computeRolling`, `numericValue` and `slideFrames` into a new `backend/src/main/scala/com/helio/domain/steps/WindowRolling.scala` (`private[steps] object WindowRolling`). It can take the comparator from `WindowStep.rowOrdering`; widen that to `private[steps]` if needed.
   - `WindowStep.apply` then calls `WindowRolling.compute(groupRows, cfg, fieldName)`.
   - In the same edit, re-indent the `else { … }` block at `WindowStep.scala:214-230` so the existing `sorted`/`match` body sits one level inside the new branch.
5. **Supply C6 mutation-red proof for every test group 4 item written after its code** (4.8, 4.9, 4.10, 4.11), recorded under `.concertino/runs/HEL-1316/evidence/`.
   - For each, record the mutation (a diff or exact description), the failing run output naming the failing test(s) and assertion, and the restore back to green.
   - Minimum set:
     - (a) 4.11/4.8: revert `stepCardFieldHandlers.ts` `usesField` to the old `running_sum|lag|lead` list. The "persists the chosen source field" and "persists exactly the fixture config" tests must go red.
     - (b) 4.8: drop the `frameUnit` spread in `onWindowChange`. The exact-key-set seam test must go red.
     - (c) 4.9: make the server misread the fixture, e.g. have `WindowConfig.decode` ignore `frameUnit` (so it computes rows mode), or map `rolling_sum` to `"string"` in `inferWindow`. `WindowRollingSeamSpec`, including the new run assertion from CR 1, must go red.
     - (d) 4.10: remove the `toRolling` 7/rows default in `WindowConfig.tsx`. "switching to a rolling function with no frame size fills 7 / rows" must go red.
   - Replace the one-line `mutation-usesField-red.txt` with a self-describing record.

### Non-blocking Suggestions

- `WindowStep.computeRolling`: `cfg.frameSize.getOrElse(1)` can never use its fallback, because `apply` has already thrown on a missing `frameSize`. Prefer `cfg.frameSize.get` with a comment, or pass the size in as a parameter.
- The frame-size input silently ignores out-of-range keystrokes. For example, typing `1001` leaves `100` with no feedback. This is acceptable under C11, but an inline hint ("1–1000") would help users.
- The 375px step-card clipping is pre-existing and worth its own follow-up ticket. It is not introduced here.
