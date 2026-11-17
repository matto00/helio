## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD e0443c24d0c02b41cdda105a410cea0b6bdf2b33 (branch feature/draft-outputs-and-shapes/HEL-1733). The change dir is
untracked; every claim below comes from the live source. Owner rulings Q1 (`inline-confirm-then-save-dialog`) and Q2
(`one-pr`) are fixed. I do not judge one PR infeasible; the defects below are design defects, not size defects.

### Round-1 change requests, re-verified against code

- **CR1 (D2):** answered. D2 now resets only step ops on `structureKey` equality (`pipelineDraft.ts:95-97` is the line that
  changes), says `isOverlayEmpty` includes `outputEdits`, and names the unit test. The Output prune rules are evaluated on the
  full interleaved replay, so "insert c1, outputCreate on c1, delete c1" still drops the create through the cascade rule.
- **CR2 (D1):** answered. One interleaved walk carrying steps and Outputs. `applyOp` returns steps unchanged for Output ops,
  and the `cascadedOutputIds` set separates a cascade from a rebase. Edit-then-delete is pruned. Tests are named.
- **CR3 (D15):** the readiness gap is addressed. `outputsLoaded` exists (`usePipelineDetailSaveWiring.ts:65-67`,
  `listStatus[id] === "succeeded"`). Moving it and `selectOutputsForPipeline` above `usePipelineDraft` is allowed by HEL-1704
  D1 (`archive/2026-11-17-split-pipeline-detail-hooks/design.md:26-33`: `useAppSelector` is effect-free). **But the gate
  introduces a new defect: see CR-A below.**
- **CR4 (D11):** answered. `base` stays steps-only, and the separate `outputsBase` is compared only when present. A v2 read
  (`keptDraft.ts:77`) maps cleanly. An older build reading v3 hits `o.version !== 2` and gets null (absent, never misapplied).
- **CR5 (D5):** mostly answered. `getAnalyzeOutputSchema` is reachable: `usePipelineAnalyzeLookups.ts:147-151`, returned
  through `usePipelineDetailAnalyze` -> `...analyze` on the page (`usePipelineDetailPage.ts:204`), and read by both layouts
  (`PipelineSpineLayout.tsx:278`, `MobileStepSheet.tsx:108`). It is the SAVED analyze, because analyze runs over
  `editor.steps` and is suspended in a draft (`usePipelineDetailAnalyze.ts:87-105, 109-114`). That is the right source.
  **One source D5 names does not exist: see CR-C.**
- **CR6 (D5 wiring):** answered. `sheetNodeStepId` page state, a picker setter, the layout adding it to `outputNodeStepIds`
  (`usePipelineDraftFrames.ts:85` carries it into `rowsStepIds`), and a jest test.
- **CR7 (D5a/spec):** answered. The spec now prohibits WRITE requests and reads naming draft-only ids, and allows saved reads.
- **CR8 (D8):** answered. The premise correction is accurate (`usePipelineShapeInstantiation.ts:64-65` itself says the
  outputs are dormant). Fresh `draft-` clientIds are minted and the `step-N` ids are used only as map keys. The
  Output-bearing path gets a unit test and an e2e titled "(stubbed /expand)".
- **CR9 (D13):** answered. Every phone entry point named in D13 exists on this branch:
  - "Step actions" > "Add output": `MobileStepSheet.tsx:70` -> `useSpineStepActions.tsx:183`.
  - The phone Outputs "+ Output" and the Output card: `PipelineMobileLayout.tsx:194-224` renders `PipelineSpine
    variant="phone"` -> `SpineOutputs.tsx:47-104`.
  - The header "Add Outputs from a shape": `MobilePipelineHeader.tsx:50-54`.
  - The aggregate tail: `OutputEditorFooter.tsx:61`. Its sheet is rendered by `PipelineDetailDialogs`, a sibling of both
    layouts.

### Other checks (with evidence)

- **D12** matches the code. `OutputService.validateConfig(kind, written, stored, policy)` exists with
  `RestorePriorStored` (`OutputConfigValidation.scala:202-226`). A whole config that re-sends a stored legacy key passes
  `tolerated` (`:71-75`), and `validateAggregation`/`validateChartType` judge only `changed` keys. Today's
  `planOutputs` passes `JsObject.empty` (`DraftDiff.scala:295-296`).
- **D7 precedents exist:** `OutputSummaryReducerSeamSpec.scala` and `DraftDiffSpec.scala`. `buildNodeCapabilities` is a
  private instance method (`PipelineNodeReads.scala:232`). The plan is to move it to the companion.
- **D9:** `buildDraftSaveRequest` already compares Outputs when loaded (`draftSaveRequest.ts:75-81`,
  `definitionMatchesBase`), so the save-time stale check already covers Outputs.

### Verdict: REFUTE

### Change Requests

1. **CR-A (D15): the Outputs gate on the restore creates a window where a user's step draft is wiped.**
   - `usePipelineDraft.ts:59-74`: once the restore effect fires, it either `setOverlay(kept.overlay)` or, with no kept
     draft, `setOverlay(EMPTY_OVERLAY)` whenever `overlayRef.current !== EMPTY_OVERLAY`.
   - The kept-draft writer (`:75-83`) does nothing until `restoredFor.current === pipelineId`.
   - Today the restore fires at steps-ready, and no step action is possible before steps load, so no window exists.
   - D15 moves the restore to `ready && outputsLoaded`, and says "the steps-only replay still renders, so a step draft is
     not delayed". That allows step edits between steps-ready and outputs-ready (`fetchOutputs` is a separate request,
     `usePipelinePageLoad.ts:72`). Any such edit is overwritten when Outputs arrive, and is not kept if the user leaves in
     that window.
   - If `fetchOutputs` fails (`listStatus` "failed", `outputsSlice.ts:292`), the restore never fires. The kept draft never
     re-applies, and no draft made on that page is kept.

   Specify the behavior for both cases. Options include: draft-creating step actions also wait for `outputsLoaded`; or the
   restore is decided at steps-ready and only the Output part waits. Also say what a failed Outputs list does to the restore
   and to the writer. Add a unit test: "a step edit made before Outputs load survives the restore" (or "is not possible").

2. **CR-B (D3): splitting `draftBlockReason` drops the HEL-1684 temp-step guards, and the design leaves Output targets on
   temp steps unruled.** `structuralBlockedReason` is one prop with more consumers than D3 lists:
   - `useSpineStepActions.tsx:179-180`: "Branch from here" is disabled when `blocked && isTempStepId`.
   - `StepCardFocused.tsx:100-101`: Duplicate is disabled when `structuralBlockedReason !== null && isDraft`.
   - `PipelineSpine.tsx:155-167`: root remove/add.

   If the layouts receive only `rootBlockReason`, then in a draft these temp-step controls become enabled but dead: the
   routed handlers silently no-op (`usePipelineDraftRouting.ts:100, 107`). That is a regression of HEL-1684 D1a.

   The same gap applies to the new Output actions:
   - "Add output" on a temp (`step-N`) step.
   - The create sheet's Step picker offering a temp step.
   - "Add as tail with aggregate" on a temp parent. D8 says "keeps it disabled with the block reason", but D3 has nulled
     that reason.

   An `outputCreate` on `{step: "step-N"}` is a trap. Save builds from `persistedSteps` with temp ids filtered out
   (`usePipelineDraftSave.ts:124`) and replays over the server definition. The op is then dropped and counted, and Save
   refuses. After the AI create completes, the id swaps and the op can never apply.

   Revise D3 to:
   - enumerate every consumer of `structuralBlockedReason`/`draftBlockReason`;
   - keep a draft temp-step reason, separate from `rootBlockReason`, for Branch, Duplicate, "Add output", the picker's temp
     options and the aggregate tail on a temp step;
   - add a unit test.

   Update the spec scenario "Structural action blocked during a draft" with the temp-step exception.

3. **CR-C (D5): "the server's own typed `schema` from its `step` line" is not available on the client.**
   - `draftPreviewClient.ts:57-66` parses `schema`, but `useDraftPreviewTransport.ts:52` keeps only
     `{kind: "ok", count: line.count}`, and `ServerStepResult` has no schema (`draftStepView.ts:28-31`).
   - Either name the plumbing (carry `schema` into `ServerStepResult`/the frames object, and add a test), or drop that bullet
     and use the `known`-typed inference for server-evaluated steps too.
   - For a ROOT node, "the analyze input schema of that root's head step" does not exist for a root with no steps. Use
     `analyzeResult.sourceSchemas` by `rootId`. Today it is reached only through the private `sourceSchemaForRoot` in
     `usePipelineAnalyzeLookups.ts:81-91`, so state that it gets exported or read from `analyzeState`.

4. **CR-D (D1/D13 A2): a root-bound create in a draft has no rule for which root.**
   - The immediate "+ Output" with no step sends neither `nodeStepId` nor `rootId`. The server binds the first root only
     when the pipeline has ONE root, and returns a 400 otherwise (`OutputRootResolution.scala:25-35`).
   - D1's `{root: rootId}` needs a concrete id, and D9 must send `rootId` (`DraftDiff.resolveNode` requires exactly one).
   - State the rule: single root -> `roots[0].id`. Multi-root -> match today: the control is disabled or the sheet requires
     a step, never a silent `roots[0]`.

### Non-blocking notes

- **D2/D15:** `pruneOverlay` is called inside every `setOverlay` updater (`withConfig`, `withEnabled`, `withOp`;
  `usePipelineDraft.ts:105-183`) with `baseStepsRef` only. The Output rules need a `baseOutputsRef` there, and must leave
  Output ops untouched when Outputs are not loaded. Say so when signing `pruneOverlay`.
- **D11:** the writer keeps `keptBaseRef` for a stale-restored draft (`:80`). It needs a matching kept `outputsBase` ref.
  `rebase(newBase: Step[])` (`:193`) also needs the new base Outputs.
- **D10:** `useDisplayedOutputNodeIds(page.allOutputs, ...)` (`PipelineMobileLayout.tsx:132`, and the desktop
  equivalent) must read `draftOutputs`. Otherwise a created Output's node never rides `rowsStepIds`. Add it to the list in
  D10.
- **D13 A8:** the aggregate tail's desktop entry is the step menu "Add output" and then the footer button, not "+ Output on
  a step". Reword it.

Verdict category: design-judgment.
