# Red runs (C12: each test written before its code)

Method: tests written first; for a group whose tests reference a new API the red is a compile failure of
`Test/compile` against the unchanged main sources (main changes were `git stash`ed to take the run, then restored).
For behaviour changes to existing code the red is an assertion failure. All runs from `backend/`:
`nice -n 19 sbt -J-Xmx3g Test/compile` or `sbt -J-Xmx3g "testOnly <spec>"`.

## Stage 1 — model key, quota weight, per-request model (tasks 1.1-1.4, 4.6/4.7 parts)

Command: `sbt -J-Xmx3g Test/compile` with only the new/changed tests present (main stashed).
Result: RED (compile). Excerpts:

    [error] .../InsightConfigSpec.scala:16:70: too many arguments (found 2, expected 1) for method parse: (config: JsObject): Either[String,InsightConfig]
    [error] .../InsightConfigSpec.scala:20:51: too many arguments (found 2, expected 1) for method parse ...
    (same for AiPipelineQuotaGateSpec `checkAndIncrement(betaUser, 4)`, ClaudeInsightClientSpec `InsightModelRequest(..., None)` / `new ClaudeInsightClient(client, ClaudeModelCatalog.all)`)

Green afterwards: `testOnly InsightConfigSpec ClaudeInsightClientSpec AiPipelineQuotaGateSpec InsightPreflightSpec InsightModelConfigWriteSpec ClaudeAiStepClientSpec OutputKindDriftSpec` -> 64 passed (then 65 after the schema `model` key was added; `OutputKindDriftSpec` was the one red: "document every insight key on the create-output-request schema *** FAILED ***", fixed by adding `model` to the four request schemas).

## Stages 2-4 — render service, triggers, role-shaped reads, refresh route, scheduler pass, frontend

Honest note on order: for these groups the test files and the production code were written in the same working session and the
tests were first run against finished code, so the red here is produced by the stash method and by mutations, not by a
failure observed before any code existed:

1. `git stash push -u -- backend/src/main` (all new and changed main sources, including the new service files) and
   `sbt Test/compile`: RED, every new spec fails to compile against the unchanged main (see `red-compile-stage2.txt`).
2. The first run of each spec against the code was red for real defects the tests caught, fixed before going green:
   - `InsightRenderServiceSpec` first run: 5 failures. Root causes (probed, not guessed): (a) `tickPass` scans every insight in the
     shared test DB, so other fixtures' insights rendered through the same fake model (sends 3 not 0) -> tests now call `isolate(fx)`;
     (b) the shared `ShiftedClock` offset leaked between tests, so render stamps ran ahead of `pipelines.last_run_at` and the
     catch-up predicate was false -> `beforeEach` resets it; (c) a test changed data without re-running the pipeline.
   - the overlapping-run test first showed `Vector(Failed, Ok)`: the in-flight render hit the 5 s test timeout while the second run
     executed -> that test uses a 60 s timeout and no longer awaits the hung first render.
3. Every guard then has a recorded mutation, see `mutations.md`.
4. `OutputInsightRoutesSpec` "carry explicit nulls ..." and `OutputInsightReadServiceShapeSpec` went red on the new shape
   (`canRefresh` key; constructor list) and were updated deliberately (R3/D13 change the contract).

## Cycle 2 (owner answers: D14 cap 4096, failed render records usage)

Tests written first. Only the data shape `InsightModelFailure.NoAnswer(reason, usage = Zero, model = None)` was added beforehand so the specs compile; behaviour unchanged. `sbt testOnly ClaudeInsightClientSpec InsightRenderServiceSpec -- -z 4096 -z usage -z cost` -> RED (assertion failures):

```
[info] - should record the usage and cost of a failed render that reached the model *** FAILED ***
[info]   (None, None, None) was not equal to (Some(4), Some(400), Some(1136)) (InsightRenderServiceSpec.scala:121)
[info] - should send max_tokens 4096 for an insight render's own request *** FAILED ***
[info]   400 was not equal to 4096 (ClaudeInsightClientSpec.scala:41)
[info] - should never exceed 4096 even when asked for more *** FAILED ***
[info]   400 was not equal to 4096 (ClaudeInsightClientSpec.scala:50)
[info] - should carry the usage and model of a response that ran out of tokens on thinking, so the failure can be costed *** FAILED ***
[info]   InsightUsage(0, 0, 0, 0) was not equal to InsightUsage(4, 400, 0, 0) (ClaudeInsightClientSpec.scala:63)
[info] Tests: succeeded 3, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
[error] Failed tests:
[error] 	com.helio.infrastructure.ai.ClaudeInsightClientSpec
[error] 	com.helio.services.insights.InsightRenderServiceSpec
[error] (Test / testSelected) sbt.TestsFailedException: Tests unsuccessful
[error] elapsed time: 5 s, cache 93%, 27 disk cache hits, 2 onsite tasks
```

### Cycle 2: e2e result (task 3c.4)

`e2e/hel1743-insight-refresh.spec.ts`, Playwright 2 workers, lane backend (7175/10082) on lane DB `helio_hel1743`, started with an EMPTY
`ANTHROPIC_API_KEY` (the backend logged `insight renders disabled`, so no model call was possible): `1 passed (9.7s)`. Not
run red first (the spec was written in cycle 1 and never run); it asserts keyless `failed` attempt after a real run, the Refresh button
posting 202, `{"trigger":"daily"}` -> 400 and `{"trigger":"pin"}` -> newest attempt trigger `pin`. The throwaway user was deleted by exact id
by the run's teardown. Servers stopped with stop-servers.sh.

## Cycle 3 (evaluation-1 change requests)

C12 note, stated plainly: the new or rewritten tests below passed on their first run against the (already correct) production code; the
red evidence for each is a recorded mutation of that code in `mutations.md` ("Cycle 3 mutations" and the corrected hook entry). Before
the fix, the previous versions of these guards were shown NOT to fail under their defect by the evaluator (hook placement, ER1 grace,
disabled-step filter): that surviving-mutation result is the red of the old test, and the replacements go red where the old ones did not.

- CR3 `RecordingTrigger` race: `futures.add` now precedes `calls.incrementAndGet`, and `settle` waits for `futures.size >= n`. Reproduction
  of the defect is the evaluator's `testFull` failure (`empty.head` at InsightRenderServiceSpec.scala:107, eval-testfull-failure.txt); the fixed spec passed 35/35 here and the full run is below.
- CR4 hook guard: now holds the render open (60 s timeout, pending promise) and requires the run, its returned future and its `succeeded` event to complete with the render in flight.
  Mutation (hook moved inside the chain, awaited): RED (`complete the run and publish succeeded while the render is still in flight`).
- CR2 ER1 overlapping: run 2's snapshot commit is gated after its write phase began; render 1 starts only after that, and reads before the commit.
  Mutation `run.isAfter(att)` (grace removed): RED. (The evaluator's own variant had survived the old test.)
- CR5: a disabled `limit` step now turns the inferred preset from Leaders to Summary; a metric-with-compare Output on another node is read via
  `reads.outputs` without changing the insight node's preset. Mutations `.filter(_.enabled)` removed and "all nodes' Outputs feed the preset signals": RED.
- CR6: R3b re-recorded against `OutputInsightRecord.forViewer`: RED.
- CR1: `e2e/hel1746-ask-ui.spec.ts` expected "Not yet rendered" after a pin. It failed 4/4 for the evaluator (a real behaviour change, render on pin). Updated to the keyless failed state plus
  exactly one `pin` attempt; results of the three e2e specs follow in this file once run.
- e2e after the fixes (Playwright 2 workers, lane DB `helio_hel1743`, `ANTHROPIC_API_KEY` empty, backend logged `insight renders disabled`, so no model call was possible):
  `hel1743-insight-refresh.spec.ts` + `hel1744-insight-panel.spec.ts` + `hel1746-ask-ui.spec.ts`: **20 passed (1.9m)**. The throwaway users were deleted by the run's teardown; servers stopped with stop-servers.sh.
- Gates after the cycle-3 fixes: `sbt -J-Xmx3g testFull` -> `Tests: succeeded 9981, failed 0, canceled 5` ("All tests passed", EXIT 0); frontend jest 824 suites / 9963 tests; lint, format, scala-quality clean.

## Cycle 4 (skeptic-final-1 CR1-CR4, UI)

Tests rewritten first. `npm --prefix frontend test -- --testPathPatterns=panels/insight/InsightPanelBody` against the unchanged panel: RED, `Tests: 9 failed, 15 passed, 24 total`
(the renamed "Update insight" button does not exist yet; no 429 message; note after the action; action inside role=status; extra "Updating…" line).
Green after the fix: panel/insight suites 58 passed; full frontend jest 824 suites; typecheck, lint, format clean. e2e hel1743 + hel1744 + hel1746 with 2 workers, lane DB, empty API key: **20 passed (1.7m)**.
Process note: the first e2e run after the change failed hel1744 4/4 (`ReferenceError: refreshButton is not defined`, a leftover reference prettier had reformatted past my replacement; typecheck had not been run yet). Found from the trace, fixed, typecheck added to the loop. Visual check at the default panel size, light and dark (`.concertino/scratch/HEL-1743/cycle4-card-{light,dark}.png`): the quota note is fully in view (asserted `toBeInViewport ratio 1`), the "Update insight" action follows it.

## Cycle 5 (skeptic-final-2 CR1: no-render states laid out as one column)

Tests first: status and action must share one `panel-content panel-content--state` container with no role (not sibling fragments in a flex row), and "Updating…" appears once with no render.
`npm --prefix frontend test -- --testPathPatterns=panels/insight/InsightPanelBody` against the unchanged panel: RED, `Tests: 3 failed, 24 passed, 27 total`.
Green after the fix: panel/insight suites 61 passed; full frontend jest run; typecheck, lint, format clean. Both no-render states checked at the default panel size in light AND dark, all four screenshots viewed (`.concertino/scratch/HEL-1743/cycle5-{fresh,failed}-{light,dark}.png`): centred, action directly under the message; plus geometry asserts (action top below status bottom, centres within 6 px). e2e hel1743 + hel1744 + hel1746, 2 workers, `DATABASE_URL` set to the lane DB for Playwright too, empty API key: **20 passed (1.9m)**.
