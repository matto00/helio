# HEL-1340 probe evidence

All Jest runs: `nice -n 19 npx jest --maxWorkers=2 <path>` from `frontend/`. Logs in the scratchpad (`hel1340-*.log`).

## Item 1 (AC1): reorder `renderKey` carry

Test: `a non-head reorder keeps a created draft's card open` in
`frontend/src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx`.

- Green at HEAD: `Tests: 9 passed, 9 total` (hel1340-item1-green.log).
- Mutation: in `usePipelineDetailPage.ts` `handleReorderSteps` (line 1291), replaced
  `{ ...pipelineStepToStep(persisted), renderKey: s.renderKey }` with `pipelineStepToStep(persisted)`.
  Result: `Tests: 1 failed, 8 passed, 9 total`; the new test fails with
  `Expected the element to have attribute: aria-expanded="true"` (hel1340-item1-red.log).
- Mutation reverted (`git checkout`); file clean.

## Item 3 (AC3): in-flight draft select placeholder

### Root-cause probe (before any fix)
Temporary `console.log` in `getAnalyzeSchema` (reverted; hel1340-item3-probe.log), test run with
`-t "while the draft's create is in flight"`:

```
3  PROBE getAnalyzeSchema step-1 analyzeEntry= false pendingMeta= true    (before the create is sent)
1  PROBE getAnalyzeSchema step-1 analyzeEntry= false pendingMeta= false   (after the create is sent)
```
After the create is sent the draft has neither an analyze entry nor `pendingDraftMetaRef` meta
(deleted at send), so `getAnalyzeSchema` returns `EMPTY_ANALYZE_SCHEMA` and the select shows its
placeholder. Hypothesis in design D4 confirmed.

### Red run (tests added, fix not yet applied; hel1340-item3-red.log)
`Tests: 3 failed, 9 passed, 12 total`. All three new tests fail with
`Expected element to have text content: notes / Received: — select a string field —`:
- keeps the chosen input field shown while the draft's create is in flight
- keeps the chosen input field shown after the create, before its own analyze lands (post-swap
  `analyzePipeline` held unresolved)
- a lane draft in flight resolves its field from its anchor, not the root source (anchor output
  exposes `notes`, root source only `other`)

### Green (fix applied; hel1340-item3-green.log)
`Test Suites: 5 passed, 5 total / Tests: 155 passed, 155 total`
(`src/features/pipelines/ui/PipelineDetailPage*`).

Fix: `draftFallbackMetaRef` (page hook, next to `pendingDraftMetaRef`) written at create send, re-keyed
temp -> persisted id in the create `.then` before `setSteps`, deleted on create failure, and dropped by
an effect once the step's current id has an analyze entry or the step is gone. The schema fallback
reads `pendingDraftMetaRef ?? draftFallbackMetaRef`. Guard and `stepsFingerprint` unchanged.

## Gates (task 5.1)
Pre-commit for each commit ran eslint, tsc, prettier, root and frontend Jest (439 suites / 4582 tests
green on commits 1 and 2); see final report for commit 3 and the explicit lint / format:check / build runs.

## Cycle 2 (evaluation-1.md change requests, item 3 follow-ups)

- CR1 (false "dropped" chips post-swap). Red: with StepCard's chip condition reverted to `!isDraft`
  only, scenario 2 fails: `Received: <span ...diff-chip--removed>− notes</span>` (1 failed, 11 passed;
  hel1340-c2-cr1-red.log). Fix: page hook exposes `hasOwnAnalyzeEntry` (`analyzeByStepId.has`), threaded
  (optional prop) PipelineDetailPage -> PipelineRiverView -> RootColumn/LaneColumn -> StepCard
  `hasOwnAnalyze` (default true); chips render only when `!isDraft && hasOwnAnalyze`. Green: 12 of 12
  (hel1340-c2-green.log).
- CR2 (lane variant pins the exact anchor). New test: trunk p-0 -> anchor-1, only p-0 has an analyze entry
  (output `notes`), root source exposes only `other`, lane draft on anchor-1 picks `other`. Mutation at
  usePipelineDetailPage.ts:555 (`pendingDraftMetaRef.current.get(stepId) ?? draftFallbackMetaRef...` ->
  `pendingDraftMetaRef.current.get(stepId)`): `1 failed, 11 passed`, lane test fails
  (hel1340-c2-cr2-red.log). Restored: 12 of 12.
- CR3 (scenario 2 timing). It now records `analyzePipelineMock.mock.calls.length` before the resolve and
  waits for it to increase (the post-swap call issued and held) before asserting.
- DRY: both meta refs typed with the exported `PendingDraftMeta`.
