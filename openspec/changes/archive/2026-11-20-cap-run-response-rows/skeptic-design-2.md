## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `fef01cda9c089e90c2f93f65e1b59ee1f11d8a16`. The planning artifacts are untracked in the change dir.
I took the owner rulings (C15: cap 10, MCP pass-through, GET /runs/:runId capped, `rowsTruncated`) as given.

### Round-1 change requests: resolved or only reworded?

- **CR1 (GET /runs/:runId cap must reach the wire): resolved.**
  - D4 now names each change: `RunStatusResponse` (`PipelineProtocol.scala:143`) gains the field, and so do its
    hand-written `write` and `read` (`:375-397`, which I confirmed are hand-written and field-by-field). The route
    translation at `PipelineRunStatusRoutes.scala:34` must copy it; I confirmed that the route constructs
    `RunStatusResponse` positionally from `cached`.
  - Task 1.4 matches D4.
  - Test 0.3 is now a route-level assertion in `PipelineRunRoutesSpec` on the real GET body. It is feasible:
    `PipelineRunRoutesSpec.scala:343-355` already seeds `PipelineRunCache.put/update(rows = Some(...))` and reads
    `responseAs[RunStatusResponse]`, so a 25-row seed is a small change.
  - Mutation 4.1 now includes "drop the field from the RunStatusResponse writer".
  - CR1(c) is decided in writing. The frontend `RunStatusResponse` (`types/pipelineStep.ts:740`) gains optional
    `rowCount` and `rowsTruncated`. I confirmed it lacks `rowCount` today.
- **CR2 (step-preview route missing from the spec): resolved.** The ADDED requirement in
  `specs/pipeline-run-response-preview/spec.md` now lists `GET /api/pipelines/:id/steps/:stepId/preview` and has a
  scenario for it ("The single-step preview reports its cut"). Test 0.2 covers it.
  - I checked D1's claim against the code. `PipelineRunPreview.scala:208` is the source-level arm
    (`targetStepId.isEmpty`) of `previewAtNode`. `:296` is the step-targeted arm. `previewStep` (`:27-32`) calls
    `previewAtNode(..., Some(stepId), ...)`, so it reaches `:296`. `previewOutputs` reaches both arms.
- **Round-1 non-blocking notes**
  - The D7 normalisation and regeneration flag are now stated.
  - The D6 optional-field rationale is now in the doc comment.

### What I verified this round (with evidence)

- **Construction sites.** `grep "RunResultResponse(" backend/src` finds four main sites: `PipelineRunExecutor:361`,
  `PipelineRunService:250`, and `PipelineRunPreview:208` and `:296`. It also finds one test site,
  `AggregatorRegressionSpec:105`. Adding the `rowsTruncated: Boolean = false` default leaves the test site compiling.
  The format is `jsonFormat11` at `PipelineProtocol.scala:405`, so the move to 12 is correct.
- **D2 (writes keep the full rows) holds.** At `PipelineRunExecutor.scala:354-356`, `onRunSuccess(..., resultRows,
  jsRows, ...)` receives the full vector. The response is built afterwards, at `:361`.
- **`CachedRunStatus`** (`PipelineRunService.scala:364-370`) has 5 fields and one construction site,
  `PipelineRunQueries.scala:76`. The cache rows are `Option[Seq[Map]]`, so "render only the first 10" is a plain
  `take(10)` before rendering.
- **Spec deltas.**
  - Every MODIFIED requirement header matches its base requirement verbatim. I checked this with a script against
    `openspec/specs/<cap>/spec.md`.
  - Every base scenario under each modified requirement is carried over: the script reports zero missing for all
    five requirements.
  - `pipeline-run-response-preview` is new and has no collision.
  - No other base spec promises every row of a run response. I grepped `openspec/specs` for all/every/full-rows
    wording near run results. `pipeline-preview-api` and `pipeline-step-preview` already say "up to 10", so adding the
    flag is purely additive.
- **Frontend claims.**
  - `SpineRunStatus.tsx:29-35` derives the count from `runResult.length`.
  - `runResult` is written at `pipelinesSlice.ts:148` and `:292`, and cleared at `:63` (`clearRunState`) and `:108`
    (the settle reducer). D5's "cleared wherever runResult is cleared" therefore means those two places.
  - The thread path is `usePipelineOwnPipeline:16/61` → `usePipelineDetailPage:215` → `PipelineSpineLayout:169` /
    `MobilePipelineHeader:172`.
  - There are two `RunResult` interfaces, at `pipelineService.ts:238` and `types/output.ts:164`.
- **MCP.** `helio-mcp/src/types.ts:743` `RunResultResponse` has no `rowsTruncated`. Both apply tools exist, in
  `tools/pipelineProposal.ts` and `tools/combinedProposal.ts`. helio-mcp tests already read `shared-test-fixtures/`
  (`insightExitCriterion.test.ts`, `joinStepSeam.test.ts`). `shared-test-fixtures/pipeline-run/` does not exist yet,
  so there is no collision.
- **e2e.** No e2e spec reads `rows` off a `/run` or apply response, and none asserts a "Snapshot replaced: N rows"
  count above 10. I grepped `e2e/`.

### Verdict: CONFIRM

The design is internally consistent, matches the live tree at every cited line, covers every AC with a task, and
resolves both round-1 change requests in substance.

### Non-blocking notes

1. **Spec seam scenario vs D7.** The ADDED "server body and fixture agree" scenario only promises a failure when
   `rows` length, `rowCount` or `rowsTruncated` differ. D7 promises a stricter comparison: the normalised body against
   the fixture as whole JSON values. Implement D7's stricter version. The spec wording is a floor, not a licence to
   compare less.
2. **Frontend test kit hazard.** `ui/pipelineSpineTestKit.tsx:135-175` builds `pipelines` state with `as never`, so
   the compiler will not catch a missing `runRowCount`.
   - Without a `runRowCount: options.runRowCount ?? null` default, `run.sseRowCount ?? run.runRowCount` evaluates to
     `undefined`, and the chip would render "Snapshot replaced: undefined rows".
   - Tests that preload `runResult` to drive the chip count must switch to preloading `runRowCount`. These are
     `PipelineDetailPage.spine.test.tsx:578` and `PipelineDetailPage.test.tsx:2234`, `:3332`, `:3344` and `:3354`.
     That switch moves the source of truth; it does not weaken anything. List those tests in `files-modified.md`.
3. **Client-side producer of `RunResult`.** `ui/outputEditor/outputSheetDraft.ts:50` (`runResultFromFrame`) builds a
   `types/output.ts` `RunResult` from a draft frame. Once `rowsTruncated` is required it needs `rowsTruncated: false`.
   The value is correct because that frame is uncut. tsc will flag it; this note just says so in advance.
4. **The Cloud Run AC ("documented").** No task line explicitly produces this documentation. The proposal's Why and
   the D-section Risks quote the quotas-page sentence, and the archived change dir will be the durable record. Also:
   - Put the docs URL and the "HTTP/2 end-to-end limit not documented; not probed (C8)" caveat in the PR body.
   - State in the PR that this is docs-backed, not measured.
5. **Name collision.** `rowsTruncated` already exists in `features/panels/history/chartOverlay.ts:28/96`, with an
   unrelated panel-rows meaning. The owner ruled on the name, so this is not a defect, but expect grep noise in review.
6. `setRunStatus` (`pipelinesSlice.ts:139-150`) is left untouched, as planned, and correctly never sets `runRowCount`.
