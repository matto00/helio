## Context

Base: origin/main f63ab8365 (`SPLIT_BASE`; record the exact SHA the split commits are proven against in
`workflow-state.md`/evidence). Paths are under `frontend/src/features/pipelines/` unless stated. Line numbers are
from SPLIT_BASE; the executor re-derives exact ranges before editing.

- `hooks/usePipelineDetailPage.ts` (592 lines) owns `stepsFetch` state (`"pending"|"fulfilled"|"failed"`, L166-168),
  the seeding block (L258-270) and `onStepsSettled` (L272-275); `hooks/usePipelinePageLoad.ts` dispatches
  `fetchPipelineSteps(id)` once per mount and calls `onStepsSettled(ok)`.
- `ui/PipelineDetailPage.tsx` L283-292 branches on `stepsLoading` only; `"failed"` falls through to
  `PipelineRiverView` (empty editor + Add buttons). L396 passes `stepCount={stepsLoading ? null : steps.length}`.
- The steps skeleton (L286-292) duplicates `ui/PipelineDetailSkeleton.tsx` L28-40 except for `role="status"` /
  `aria-label="Loading steps"` on the outer div and the comment.
- Settled-render helper: `ui/PipelineDetailPage.test.tsx` L354 `renderDetailPageSettled(id, store)`,
  `ui/PipelineDetailPage.creatingStep.test.tsx` L192 and `ui/PipelineDetailPage.draftCreate.test.tsx` L199
  `renderPageSettled(store)`; all three are `render; await act(async () => {}); return result`.
- `state/pipelinesSlice.ts` (707): helpers + state type + initialState L1-180, thunks L182-415, slice L417-707.
- `ui/PipelineDetailPage.switch.test.tsx`: L388/L421 test names say A's continuation "refetches A late", but
  `hooks/usePipelineRootAndToggleActions.ts` L64/L86 gate that refetch on `mountedRef.current`, so an unmounted A
  never refetches. L311 is the direct-fetch test.
- Parked PRs: #998 touches `state/laneLayout.ts`, `ui/stepConfigs/SecondaryInputPicker.tsx` (+tests); #994 touches
  `features/patchSets/*`, `features/assistant/proposalExtraction*`. None is in scope; do not edit them.

## Goals / Non-Goals

Goals: AC1-AC6 of ticket.md. Non-goals: Run/Dry run enablement change, page-level load error, any backend change,
any file of #998/#994, redoing HEL-1484.

## Decisions

### D1 — Commit order (proof isolation)
1. Characterization (green on SPLIT_BASE, own commit, test files only). 2. Slice split. 3. Hook split.
4. Shared river skeleton. 5. Test-helper dedupe. 6. Switch-test tightening. 7. Steps error state + Retry.
Moves (2-3) land before any behaviour change so byte proofs run against SPLIT_BASE. Behaviour (7) lands last.

### D2 — Slice split (`pipelinesSlice.ts` → ≤ ~400)
- New `state/pipelinesThunks.ts`: every `createAsyncThunk` export and `FetchRunHistoryArg` (L182-415), plus the
  private helpers they use (`extractErrorMessage`, `PipelineSummaryWire`, `normalizePipelineSummary`), moved
  byte-identical. If a helper is also used by the reducers, it is exported from its new home and imported back.
- New `state/pipelinesState.ts` (required: moving thunks+helpers alone leaves ~437 lines): `PipelinesState` +
  `initialState` (L73-180), byte-identical. Target `pipelinesSlice.ts` ≈ 330.
- `pipelinesSlice.ts` keeps the slice, `isStaleCurrentPipelineResponse`, the action/reducer exports, and adds
  `export { ... } from "./pipelinesThunks"` re-exporting every moved public name, so **no importer changes**
  (no file outside `state/` is edited by this commit). No circular import: thunk module must not import the slice.
- Export-surface proof: a characterization test (D5) asserting the sorted runtime export list equals SPLIT_BASE's,
  plus compile-time pins for the type-only exports (`FetchRunHistoryArg`, `PipelinesState`) — nothing in
  `frontend/src` imports them today, so plain tsc would stay green if the barrel dropped them.

### D3 — Hook split (`usePipelineDetailPage.ts`, verbatim order-preserving moves only)
Extract contiguous clusters into new `hooks/<name>.ts` hooks called at exactly the line the cluster began, taking
outer values as one params object and returning the bindings later code reads (HEL-1465 D3 shape). The returned
object (L~495-592) stays verbatim in the host (HEL-1481 precedent). Clusters (SPLIT_BASE lines; est. net saving):
- K1 L49-92 `usePipelineOwnPipeline`: the sources + pipelines selectors and the `ownPipeline` /
  `currentPipeline*` derivation (useAppSelector x2, useState). ~-20.
- K2 L94-121 `usePipelineAnalyzeState`: `analyzeResult`, `analyzeStatus` + `analyzeStatusRef` + its layout effect,
  `pipelineSchedule`. ~-15.
- K3 L161-220 `usePipelineEditorFlags`: `stepsInitialized`, `stepsFetch` (+ derived), `seedToken`/
  `consumedSeedTokenRef`, `dropdownOpenAt`, `sseActive`/`sseActiveRef`+layout effect, the analyze-guard refs,
  `stepsFingerprintRef`, with their comments. ~-40.
- K4 L373-400 if contiguous and hook-order-safe: `isDirty` beforeunload effect + `sourceByRootId` + `isOwner`. ~-10.
Estimated host after K1-K4: ~490-510 lines. **Line target:** the ~400 guideline is NOT reachable with verbatim,
order-preserving moves while keeping the return object in the host. Fallback (decided now, not at execution):
do K1-K4, record the measured line count, and file a Follow-up (label Follow-up, relatedTo HEL-1501) for the
remainder (reshaping the return surface, which changes `PipelineDetailPage.tsx`'s destructuring and needs its own
proof). The PR states the measured number. Each new hook file ≤ ~250 lines.
- Rule: primitive React hook sequence (comment-stripped, sub-hooks inlined) identical to SPLIT_BASE; any deps-array
  edit is non-verbatim and must be enumerated and covered by the identity characterization test.
- No new `eslint-disable`; if moving a cluster exposes React-Compiler lint errors, narrow or drop that cluster.

### D4 — Shared river skeleton
New `ui/PipelineRiverSkeleton.tsx` exporting `PipelineRiverSkeleton({ ariaLabel }: { ariaLabel?: string })`
rendering the existing outer `.pipeline-detail-page__river` div (with `role="status"`+`aria-label` only when
`ariaLabel` is given), the `river-inner--skeleton` div and three ribbon `Skeleton`s; the skeptic-final gap comment
moves with it. `PipelineDetailSkeleton` renders `<PipelineRiverSkeleton />` (no role: it is already inside
`PageStatus`'s loading region); the page renders `<PipelineRiverSkeleton ariaLabel="Loading steps" />`. Proof:
DOM `outerHTML` of both call sites unchanged vs SPLIT_BASE (a test or recorded snapshot diff).

### D5 — Characterization tests (commit 1, green on SPLIT_BASE)
- Reuse `hooks/usePipelineDetailPage.identity.test.tsx` (already pins handler identity); extend only if a moved
  cluster's outputs are not covered, and show red under a non-stable-dep mutation per HEL-1465 D3.
- New `state/pipelinesSlice.exports.test.ts`: sorted runtime export names of `./pipelinesSlice` equal the literal
  SPLIT_BASE list, and `import type { FetchRunHistoryArg, PipelinesState } from "./pipelinesSlice"` used in typed
  declarations (`const arg: FetchRunHistoryArg = {...}`, a `PipelinesState` key check). Red runs: delete one runtime
  re-export → jest red; delete the `FetchRunHistoryArg` type re-export → `npm run typecheck` red; revert both.

### D6 — Test-helper dedupe
New `ui/pipelineDetailPageTestUtils.ts` (not a `*.test.*` file) exporting
`async function settled<T>(rendered: T): Promise<T> { await act(async () => {}); return rendered; }` (or an
equivalent that takes the already-rendered result). Each file keeps its own `renderPage`/`renderDetailPage` (they
differ by mocks/store) and its call sites become `await settled(renderPage(store))` — or the file keeps a one-line
local alias. The three bodies are removed; every assertion is unchanged; jest counts per file equal before/after.

### D7 — Switch-test tightening
- Rename L388/L421 and the `it.each` at L454-485 ("keeps B's editor … when A's %s continuation refetches A late"),
  and fix the comments at L386-387, L452-453 and L477, to describe the real scenario: A's add/remove-root
  continuation resolves after the switch and, because its page is unmounted, issues no refetch of A.
- In each of those tests add a scoped assertion: capture `const callsAtSwitch =
  jest.mocked(getPipelineById).mock.calls.length` immediately before `navigateTo("/pipelines/B")`, and after the
  continuation resolves assert `mock.calls.slice(callsAtSwitch).map(c => c[0])` does not contain "A" (A's own mount
  call is legitimately before the switch). Red run: remove the `mountedRef.current &&` gate at
  `usePipelineRootAndToggleActions.ts` L64 (resp. the `if (mountedRef.current)` at L86) → red; revert.
- Direct-fetch test (L311): add `expect(getPipelineById).toHaveBeenLastCalledWith("B")`.
- `act(...)` warnings: record the warning count from a run of the file on SPLIT_BASE and after; target zero. Fix by
  awaiting the settling update in the test (never by silencing console or wrapping production code).
- The L291 test ("a rejected steps fetch ... shows the empty editor") is rewritten in commit 7 to assert the error
  state; that is the intended behaviour change, called out in the PR.

### D8 — Steps error state with Retry (commit 7, the only behaviour change)
- `usePipelinePageLoad` gains `retryStepsLoad` (stable `useCallback`): no-op without `id`; calls a new
  `onStepsRetry()` arg (host sets `stepsFetch` to `"pending"`), then dispatches `fetchPipelineSteps(id)` and routes
  its settle through the existing `onStepsSettled`. On a fulfilled retry, if this pipeline's `analyzeStatus` is
  `"failed"` (read via the host's `analyzeStatusRef`, passed in), it also dispatches `analyzePipeline(id)`: the
  seed bumps `seedToken`, which `usePipelineDebouncedAnalyze.ts` L64-67 consumes without dispatching, so without
  this a same-outage analyze failure would leave the recovered cards schema-less. When analyze already succeeded
  at mount it is NOT re-dispatched (keeps F-105's no-duplicate-analyze invariant). No pipeline refetch.
- Host exposes `stepsFailed = stepsFetch === "failed"` and `retryStepsLoad` on its result.
- Page: `stepsLoading ? <PipelineRiverSkeleton ariaLabel="Loading steps" /> : stepsFailed ?
  <PageStatus status="failed" size="section" message={STEPS_LOAD_ERROR} onRetry={retryStepsLoad} /> :
  <PipelineRiverView …/>`. `stepCount={stepsLoading || stepsFailed ? null : steps.length}` (rendered by `PipelineDetailFooter.tsx`
  L218-220 — the footer, not the header).
- Copy (assumed call A1): `"Couldn't load this pipeline's steps."` — mirrors the page-level title "Couldn't load
  this pipeline"; the Retry label comes from `PageStatus`. No server error text (it is a section with no title slot,
  and raw Axios messages are not user copy).
- Seeding after a successful retry works unchanged: `stepsInitialized` stayed false on failure, so the existing
  derived-state block seeds once `stepsFetch` becomes `"fulfilled"`.
- Tests (red first on the pre-commit-7 tree): failed fetch → error + Retry, no "No steps yet", no "+ Add step";
  Retry → skeleton then cards; Retry fails again → error again; footer count not "0" while failed; steps+analyze
  both failed at mount → Retry dispatches `analyzePipeline` once more; analyze ok at mount → Retry does not.

## Risks / Trade-offs

- Hook-order drift from extraction → hook-sequence proof gates every hook commit.
- Re-export barrel hides a missed name → runtime export-list test + tsc.
- A late steps resolution after unmount → page is keyed by `:id`, so the retry's setState targets only its own mount.

## Planner Notes

- A1 (copy) and A2 (Run/Dry run stay enabled during skeleton and error: a run executes the server's persisted
  definition and does not depend on the client's steps view) are assumed product calls → PR gets OWNER REVIEW and
  is parked unmerged per the overnight rules.
- Branch prefix `task/` (mostly tests/refactor; one small UI behaviour).
- Design-gate r2 non-blocking notes adopted: (a) A3 = narrowed AC4 (hook line target) goes in OWNER REVIEW with the
  measured count + Follow-up id; (b) the retry's steps-settle and analyze dispatch run only while the page is still
  mounted (same `mountedRef` pattern as `usePipelineRootAndToggleActions.ts`); (c) also take L123-160, L304-310,
  L346-355 into K-clusters where verbatim and order-preserving, else name them in the Follow-up; (d) schedule thunks
  go to `state/pipelineScheduleThunks.ts` so no new file exceeds ~250 lines; (e) report the hook's line count after
  commit 3 and after commit 7.
