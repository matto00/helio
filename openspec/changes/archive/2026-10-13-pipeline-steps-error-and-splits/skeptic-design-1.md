## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD f63ab8365d2b0e6cac36154a83437b6d26b3a209 (= SPLIT_BASE). The change dir is untracked, with no code
changes. Every line number below was read from this tree.

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/pipeline-editor-steps-error-split/HEL-1501`.
- Premise claims are accurate. `wc -l`: hook 592, slice 707. `usePipelineDetailPage.ts` L166-168 holds `stepsFetch`.
  `PipelineDetailPage.tsx` L283-292 branches only on `stepsLoading`. The switch test L291 asserts the empty-editor
  fallback. The `mountedRef.current` gates are at `usePipelineRootAndToggleActions.ts` L64 and L86. The three
  settled helpers (L354, L192, L199) have identical bodies.
- **D2 (slice barrel / cycles): sound, apart from CR4.**
  - The thunk region L182-415 uses `extractErrorMessage` and `normalizePipelineSummary`. Neither is used by the
    reducers L417-707, where `normalizePipelineSummary` appears only in a comment.
  - The thunks reach `RootState` only through `import type` (erased at runtime). They never reference the slice,
    `initialState` or `PipelinesState`.
  - `isStaleCurrentPipelineResponse` is reducer-only.
  - No `jest.mock`/`spyOn` targets the slice module (grep of `features/pipelines` and `src`: zero hits). Re-export
    getters are therefore safe, and the 55 importers need no edits.
  - Budget arithmetic: imports ~36 + helpers ~36 + state 108 + thunks 234 + slice 291. Moving only the thunks leaves
    about 440-460 lines once the import-back and re-export blocks are added. `pipelinesState.ts` is therefore needed
    in practice, not "only if needed". That is fine as written, because the executor will discover it.
- **D3 (hook split): hook-order reasoning correct; line target not shown reachable.** See CR1.
  - Order-preservation: L44-240 is one uninterrupted run of primitive hooks plus `useRunHistory`. Contiguous
    extractions inside it preserve order.
  - The seed cluster as D3 describes it is not order-preserving. Its state sits at L161-175. The seeding block
    (L259-270) and the `onStepsSettled` `useCallback` (L272-275) come after `usePipelineRunStream` (L244). Moving the
    `useCallback` up would reorder hooks. D3 already acknowledges this and has a fallback.
- **D4:** the page's skeleton (L286-292) and `PipelineDetailSkeleton.tsx` L28-40 differ only by `role`/`aria-label`
  and a JSX comment. JSX comments emit no DOM, so the outerHTML-unchanged claim is credible.
- **D6:** non-test util precedent exists (`src/shared/ui/tapTargetTestUtils.ts`, `src/theme/panelReadableTones.testUtils.ts`).
  `jest.config` `testMatch` only picks up `*.test.ts(x)`.
- **D7:** the red run for the new never-called-with-"A" assertion is real.
  - `fetchPipelineById` has no `condition` (slice L210-220). Removing the L64 (or L86) gate therefore makes A's
    continuation call `getPipelineById("A")` after the switch, and none of the existing assertions catch that.
  - This holds only if the assertion is scoped to calls after the switch (CR3b).
- **D8 (retry / seeding / seedToken / analyze):**
  - The seeding condition is `!stepsInitialized && stepsFetchedThisMount && persistedSteps.length > 0` (L260). It does
    seed after a "failed" → "pending" → "fulfilled" retry, because nothing reachable in the failed state sets
    `stepsInitialized` once the Add controls are hidden.
  - After a successful retry, `steps` still never gets analyzed (see CR2):
    - The seed bumps `seedToken`. `usePipelineDebouncedAnalyze.ts` L64-67 then consumes the token and returns without
      dispatching.
    - D8 also says "No analyze/pipeline refetch".
  - The Retry button cannot be double-fired. `setStepsFetch("pending")` swaps the `PageStatus` for the skeleton in
    the same discrete-event render.
- **PageStatus API:** `size="section"` + `status="failed"` + `message` + `onRetry` exist (`shared/ui/PageStatus.tsx`
  L22-42, L105-120). It renders a `<p role="alert">` with a Retry button.

### Verdict: REFUTE

### Change Requests

1. **D3 has no line budget, and one of its named candidates saves nothing.** AC4 requires `usePipelineDetailPage.ts`
   at or under ~400 lines (from 592, so about 190 lines must go).
   - **The returned-object candidate.** It is the L496-591 object built from local bindings. A pure
     `buildPipelineDetailPageResult` would have to receive every one of those bindings, so it saves no lines. It also
     contradicts the HEL-1481 precedent (`archive/2026-10-10-split-step-card-state-hook/design.md` D1: the return
     object stays verbatim in the host, with key set and key order pinned).
   - **The analyze-guard cluster (L177-220).** It nets about 30 lines after its 8-binding destructure.
   - **The seed cluster.** It is acknowledged as probably infeasible.
   - **Everything else is unspecified.** HEL-1478 deliberately left the selectors, state, derived-state block and
     return object in the host (its D3 "Stays in host").
   - My own rough budget is below. Each cluster's net saving is its line count minus the destructure lines at its call
     site:
     - `L49-91` own-pipeline selectors: ~22
     - `L93-121` analyze/schedule selectors: ~20
     - `L123-160` steps/draft refs: ~27
     - `L177-220`: ~33
     - fingerprint `L287-310`: ~20
     - clear-run effect `L346-355`: ~9
     - `L371-400` dirty/owner derivations: ~18
   - That totals ~150, which lands around 440 once the new imports are added. Reaching ~400 needs either one very
     large prelude hook (which then breaches CONTRIBUTING's ~250-per-file budget) or a non-verbatim reshaping of the
     return object.
   - Required revision:
     - Name the exact SPLIT_BASE ranges of the clusters to extract, with a per-cluster net-line estimate whose total
       shows the host reaching ≤ ~400 and every new file ≤ ~250.
     - Drop or justify the result-builder candidate.
     - State the fallback if the target is not reachable with verbatim, order-preserving moves: for example, record
       the residual count and its cause in the PR/OWNER REVIEW, rather than improvising a non-verbatim restructure
       mid-execution.
2. **D8 retry recovery skips analyze, so it is not "as a first open would" (AC1).**
   - A first open dispatches `analyzePipeline(id)` alongside the steps fetch (`usePipelinePageLoad.ts` L56-59).
   - On retry, D8 dispatches only `fetchPipelineSteps`. The resulting seed bumps `seedToken`, which the debounced
     effect consumes without dispatching (`usePipelineDebouncedAnalyze.ts` L64-67).
   - If the mount-time analyze failed in the same outage that failed the steps fetch (the likely case for a network
     blip), the recovered cards have no `analyzeResult`: no input/output schema, field pickers, validation or cost
     verdict, until the user edits something.
   - Required revision: D8 must decide this explicitly. Either:
     - (a) `retryStepsLoad` also re-dispatches `analyzePipeline(id)` when `state.pipelines.analyzeStatus[id] === "failed"`
       (or unconditionally), or
     - (b) it records why a stale or missing analyze after retry is acceptable.
   - Under (a), add a test: mount with both steps and analyze rejected → Retry → analyze is called again and a card's
     schema-dependent UI renders. Under either option, state the seedToken interaction in the design.
3. **D7 is incomplete against AC5 ("Switch tests renamed to match behaviour").**
   - (a) A third test makes the same false claim and is not in the plan: the `it.each(["add-root","remove-root"])`
     test at `PipelineDetailPage.switch.test.tsx` L454-485. Its name is "keeps B's editor ... when A's %s continuation
     refetches A late". Its body comment (L477, "A's continuation refetches A") and the L452-453 lead comment ("A's
     late refetch supersedes the singleton") are false for the same `mountedRef` reason. Rename it, fix its comments
     and give it the same never-called-with-"A" assertion, or record why it is excluded.
   - (b) Say how "never called with "A" after the switch" is scoped. `getPipelineById("A")` is legitimately called at
     A's mount, so an unscoped `not.toHaveBeenCalledWith("A")` is red on correct code. Specify a `mockClear()`
     immediately after `navigateTo("/pipelines/B")`, or a check over the call list after the switch index.
4. **D2's type-export proof is vacuous.** D2 claims "plus `tsc` green (type exports)". However,
   `pipelinesSlice.ts` exports the types `FetchRunHistoryArg` (L280) and `PipelinesState` (L706), and no file in
   `frontend/src` imports either one (grep of `import` lines for either name outside the slice: zero hits). So `tsc`
   would stay green if the barrel dropped them, and the runtime export-list test cannot see types. Add a type-level
   pin: for example, `pipelinesSlice.exports.test.ts` does `import type { FetchRunHistoryArg, PipelinesState } from "./pipelinesSlice"`
   and uses each in a type position. Its red run is deleting one of the type re-exports, which makes `tsc` red.
5. **The step count is in the footer, not the header.** The spec ("the header SHALL NOT report a step count of 0")
   and the D8 test ("header count not '0'") name the wrong component. `stepCount` is rendered by
   `PipelineDetailFooter.tsx` L218-220 (passed at `PipelineDetailPage.tsx` L396), and `PipelineDetailHeader` has no
   step count. Correct the spec and design to "footer". Make the test assert that the footer's "N steps" text is
   absent while the steps fetch has failed, so it cannot pass vacuously against a header that never shows a count.

### Non-blocking notes

- **D8 visual weight.** `size="section"` renders a bare one-line `<p role="alert">` inside a tabpanel that has no
  section `<h2>` (`PageStatus` documents section size as living under the section's own heading). Consider rendering
  it inside the `.pipeline-detail-page__river` frame so the tab keeps its geometry. This will be judged visually at
  the final gate in both themes.
- **Failed state, header root removal.** The header's root add/remove stays live in the failed state. A successful
  `handleRemoveRoot` runs `syncStepsFromServer()` (it fills `steps`), but `stepsFetch` stays "failed", so the error
  still shows over known steps until Retry. That is acceptable, but say so in the design.
- **Failed state, Outputs tab.** The Outputs tab gets `steps=[]` in the failed state, the same as base. Out of AC1's
  "Steps tab" scope; worth one line in the PR.
- **D1 commit 1 has nothing to pin unless D3 actually moves something not already in `STEP_INDEPENDENT_KEYS`/
  identity coverage.** That is fine, as long as 1.2's "covered" conclusion is evidenced with the identity test's key
  list.
- **A1 copy and A2 (Run/Dry run stay enabled) are reasonable assumed calls.** A2's rationale is correct: a run
  executes the server's persisted definition.
