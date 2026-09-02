## Cycle 1 (tasks 1.x groundwork + 2.1/2.2/2.3 partial)

- `frontend/src/features/pipelines/types/output.ts` — new: wire types for `Output`, `RunResult`, `PipelinePreviewResult`, `NodeCapabilities`, mirroring `OutputProtocol.scala`/`NodeCapabilitiesProtocol.scala`, verified against the real routes (`OutputRoutes.scala`, `PipelineRunStatusRoutes.scala`).
- `frontend/src/features/pipelines/services/outputService.ts` — new: HTTP layer for Output CRUD, `GET /api/outputs/:id/panels`, `/assertion-status`, `/rows`, `GET /api/pipelines/:id/capabilities?stepId=`, both preview arms (`POST /api/pipelines/:id/preview?outputId=` and `GET /api/pipelines/:id/steps/:stepId/preview` for unsaved Outputs, per design.md decision 5), `validate-expression`. Normalizes the spray-json absent-`nodeStepId` gotcha at the boundary.
- `frontend/src/features/pipelines/state/outputsSlice.ts` — new: Redux slice for Output CRUD, capabilities-at-node cache, and a shared preview cache keyed by `outputId` / `step:<stepId>`. Implements the HEL-681 out-of-order-response guard (per-key monotonic request token) and the HEL-878 `resetRunScopedState` reducer (task 2.4 partial — not yet wired into the run-thunk lifecycle or SSE handlers, since those live in `pipelinesSlice`/`usePipelineRunEvents`, task 3.x/9.x work).
- `frontend/src/features/pipelines/state/outputsSlice.test.ts` — new: regression coverage for the absent-`nodeStepId` normalization, the HEL-681 stale-response guard, and `resetRunScopedState`.
- `frontend/src/store/store.ts` — registers `outputsReducer` under the `outputs` key.

## Ground truth verified this cycle (task 1.2)

- `GET/POST /api/pipelines/:id/outputs`, `GET/PATCH/DELETE /api/outputs/:id`, `GET /api/outputs/:id/panels`, `/assertion-status`, `/rows`, `GET /api/outputs` (lean list) — read directly from `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala` and `OutputProtocol.scala`.
- `GET /api/pipelines/:id/capabilities?stepId=` — `PipelineRoutes.scala` + `NodeCapabilitiesProtocol.scala`.
- Both preview arms (`POST /api/pipelines/:id/preview?outputId=`, `GET /api/pipelines/:id/steps/:stepId/preview`) — `PipelineRunStatusRoutes.scala` + `PipelineProtocol.scala`'s `RunResultResponse`/`OutputPreviewEntry`/`PipelinePreviewResponse`.

## NOT done this cycle (remaining tasks.md sections 1.1/1.3/1.4 and 3-10)

This is a large, multi-day rebuild (river/tails/rail, Outputs gallery tab, Output side sheet migrating `features/panels/ui/editors/*`, shapes retarget, new-pipeline flow, header/cleanup, Jest/Playwright coverage, OpenSpec sync). Cycle 1 scoped to solid, tested data-layer groundwork (section 2, partial) plus route verification (section 1.2) rather than attempting the full UI rebuild in one pass with unverified evidence. Task checkboxes in `tasks.md` are left unchecked except where noted below; remaining sections carry into the next cycle.

## Cycle 2

- `frontend/src/features/pipelines/hooks/usePipelinePreviewCache.ts` — new: `useOutputPreview`/`useUnsavedStepPreview`, the shared preview-cache hooks task 2.2 calls for (rail chip thumbnails and the Output sheet will both call these directly, one call per rendered item, keeping hook-call order stable per React's rules).
- `frontend/src/features/pipelines/hooks/usePipelinePreviewCache.test.tsx` — new: regression coverage for both hooks against a real (mocked-`httpClient`) Redux store.
- `openspec/changes/pipeline-page-outputs-rebuild/{tasks.md,execution-progress.md}` — task 1.1 (dev servers confirmed NOT running this cycle — no UI evidence collected), 1.3 (dataTypeId/expand consumer enumeration), 1.4 (run-scoped-state enumeration for the HEL-878 PR writeup) recorded.

## Still not done (carries to next cycle)

Tasks 2.4 (wire `resetRunScopedState` into `pipelinesSlice`'s run thunks + `usePipelineRunEvents`), 2.5, and all of sections 3–10 (river/tails/rail, Outputs gallery, Output sheet migration, shapes, new-pipeline flow, header/cleanup, Jest/Playwright, OpenSpec sweep). None of this cycle's work required starting the dev servers; sections 3+ genuinely do (river rendering, live thumbnails, Playwright), and task 1.1 found both stopped for this worktree.

## Cycle 3

- `frontend/src/features/pipelines/ui/OutputsRail.tsx` — new: presentational per-step Outputs-rail chip row (task 3.3 partial — component built and tested, not yet wired into `StepCard.tsx`; see execution-progress.md Cycle 3 for why).
- `frontend/src/features/pipelines/ui/OutputsRail.css` — new: DESIGN.md-token-only styling for the rail chips.
- `frontend/src/features/pipelines/ui/OutputsRail.test.tsx` — new: chip-per-Output rendering, thumbnail-from-preview-cache, and click-handler coverage.

## Cycle 4 (tasks 3.1/3.2 — HEL-682 split, behavior-preserving)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — new: all `PipelineDetailPage.tsx` state/effects/handlers, extracted verbatim (F-146/F-105 invariants preserved exactly).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — now a pure page shell consuming `usePipelineDetailPage`.
- `frontend/src/features/pipelines/hooks/useStepCardPreview.ts` — new: the `StepCard.tsx` inline preview-tray state machine, extracted verbatim (HEL-412 evaluation-1.md CR1 disabled→enabled-transition rule preserved).
- `frontend/src/features/pipelines/ui/StepOpEditor.tsx` — new: the ~20-branch per-op-type editor ladder, extracted verbatim from `StepCard.tsx`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — now the trunk card (header/actions chrome), delegating to `StepOpEditor`/`useStepCardPreview`.
- `e2e/hel908-step-card-split.spec.ts` — new: live verification against real running dev servers — F-105 (exactly one `/analyze` call on initial load) and F-146 functional coverage (duplicate/reorder/toggle/run all still work end to end).

## Cycle 5 (replacement executor — tasks 2.4, 3.3 closed out; 3.6 partial; 3.5 re-confirmed)

- `frontend/src/features/pipelines/state/outputsSlice.ts` — task 2.4: `extraReducers` now matches `pipelinesSlice`'s `submitPipelineRun.pending` (one-way import, no cycle) to reset the preview cache the instant a new run starts. New `selectOutputsByStepId`/`selectPreviewRowCountByOutputId` memoized selectors for task 3.3.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — task 2.4: dispatches `resetRunScopedState()` alongside `clearRunState()` from the SSE `onTerminal` handler and the pipeline-navigation cleanup effect. Task 3.3: dispatches `fetchOutputs` on mount; exposes `outputsByStepId`/`previewRowCountByOutputId`/`handleOpenOutput`/`handleAddOutput` (the latter two stubbed with an info toast pending task 5.1's `OutputEditorSheet`).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — threads the new outputs props into `PipelineRiverView`.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — threads `outputsByStepId`/`previewRowCountByOutputId`/`onOpenOutput`/`onAddOutput` down to each `StepCard` (F-146 `EMPTY_OUTPUTS` stable-reference pattern).
- `frontend/src/features/pipelines/ui/StepCard.tsx` — renders `OutputsRail` (task 3.3), always visible, right after the header.
- `frontend/src/features/pipelines/ui/OutputsRail.tsx`/`.css` — task 3.6: chips now use the `tap-expand-44` hit-expander utility (44px touch target, 28px painted box), probe-confirmed via Playwright at a 375px viewport.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — fixed a pre-existing gap (this test's own `makeStore()` was missing the `outputs` reducer entirely, breaking on `state.outputs` being `undefined`); added `outputsReducer`.
- `frontend/src/features/pipelines/ui/StepCard.test.tsx`/`PipelineRiverView.test.tsx` — updated `baseProps` for the new required `outputs`/`previewRowCountByOutputId`/`onOpenOutput`/`onAddOutput` props.
- `openspec/changes/pipeline-page-outputs-rebuild/{tasks.md,execution-progress.md}` — Cycle 5 progress recorded, including the HEL-676 (task 3.6) investigation that could not reproduce an overlap in the current build (documented rather than guessing at a fix).

## Cycle 6 (replacement executor — task 3.4 data-model/render landed; "+ tail" create escalated, not shipped)

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `parentStepId` added to `BasePipelineStep` (wire), mirroring the backend `PipelineStepProtocol.parentStepId` (verified present).
- `frontend/src/features/pipelines/types/step.ts` — `parentStepId` added to the UI `Step` type.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `pipelineStepToStep` carries `parentStepId` through; `makeStep` accepts an optional `parentStepId`.
- `frontend/src/features/pipelines/services/pipelineService.ts` — `createPipelineStep` gained an optional `parentStepId` 5th param (documents the backend's actual `parentStepId`-wins-over-`position` precedence); currently unused by any live caller after the "+ tail" removal below.
- `frontend/src/features/pipelines/state/stepTree.ts` — new: `buildStepTree`/`hasTail`, the trunk/tail grouping selector (design.md decision 1), derived purely from array order (no `position` field needed on the UI `Step` type).
- `frontend/src/features/pipelines/state/stepTree.test.ts` — new: 6 Jest cases.
- `frontend/src/features/pipelines/ui/TailChain.tsx` — new: renders a trunk node's tail nested/indented/dashed, reusing `StepCard` via its new `isTail` prop.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — new `isTail` prop (hides drag handle + Move up/down buttons on a tail card, applies a `--tail` modifier class). A "+ tail" create button/dropdown was added then REMOVED this same cycle — see execution-progress.md Cycle 6 for the live-probe-confirmed backend defect that made it unsafe to ship.
- `frontend/src/features/pipelines/ui/StepCard.test.tsx` — 3 new `isTail` render cases; the 6 "+ tail" button cases from the same removed feature were deleted (replaced with a doc comment pointing to the escalation).
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — main list now maps `stepTree.trunk` (not the flat `steps` array); renders one `TailChain` per trunk node. New `stepTree` prop.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — `baseProps` derives `stepTree` via `buildStepTree` from the fixture steps.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — exposes `stepTree` (memoized via `buildStepTree(steps)`). A `handleAddTailStep` was added then removed this same cycle (see above); a doc comment records why at the removal site.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — threads `stepTree` into `PipelineRiverView`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — new tail-chain CSS (indented, dashed connector). The add-tail-button CSS added then removed alongside the button is NOT present in the final diff.
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — this file's HEL-439 line-number-pinned baseline for `PipelineDetailPage.css` shifted +26 for every entry at/after the tail-chain CSS insertion point (computed via `git diff --unified=0` offset arithmetic, not guessed).
- `openspec/changes/pipeline-page-outputs-rebuild/{tasks.md,execution-progress.md,files-modified.md}` — Cycle 6 progress + the full root-cause trace for the escalation, plus a secondary finding (trunk reorder via `PUT /steps/order` may itself be a silent no-op post-HEL-904 — not yet confirmed either way, flagged rather than left on stale "green" evidence).

## Cycle 7 (replacement executor — task 2.5 re-verified/documented; task 4.1 done, 4.2 partial, 4.4 partial)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — imports `selectOutputsForPipeline`; exposes a new `allOutputs` flat list (distinct from the already-grouped `outputsByStepId`) feeding the gallery tab's card grid and "Outputs (N)" count.
- `frontend/src/features/pipelines/ui/OutputGalleryCard.tsx` — new: one gallery card per Output (task 4.2). "off <step>" subtitle resolves `nodeStepId` against the step list, or reads "off the pipeline root" when absent (per `types/output.ts`'s spray-json absent-vs-null note). Placement count via a local per-card `useEffect` calling the already-exported `listOutputPanels`. Live panel-renderer reuse deliberately NOT attempted — documented why in the file's own header comment (no Output->Panel adapter exists before task 5.1).
- `frontend/src/features/pipelines/ui/OutputGalleryCard.css` — new: DESIGN.md-token-only styling.
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.tsx` — new: the "Outputs (N)" tab body (task 4.1/4.4) — flat grid of `OutputGalleryCard`, empty state, "+ New output" button (still routed through the existing toast-stub `handleAddOutput`).
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.css` — new.
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.test.tsx` — new: 5 Jest cases (card-per-Output + subtitle resolution, lazy placement-count fetch, open-card click, add-output click, empty state).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — new `role="tablist"` Steps/Outputs tab bar (local `useState<DetailTab>`, not persisted/run-scoped); river view renders under "Steps", `OutputsGalleryTab` under "Outputs (N)".
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — new tab-bar CSS (DESIGN.md tokens only).
- `openspec/changes/pipeline-page-outputs-rebuild/{tasks.md,execution-progress.md,files-modified.md}` — Cycle 7 progress; task 2.5's blocking reason re-verified with a fresh grep and documented precisely (every remaining `selectPipelineOutputDataTypes` call site is inside the five editor files section 5 rewrites) rather than left as a vague "entangled" note.

## Cycle 8 (replacement executor — human ruling on Cycle 6's escalation: backend branch-attach primitive + tail-attach UI + reorder finding)

- `openspec/changes/pipeline-page-outputs-rebuild/design.md` — new "Non-goal waiver" subsection recording the human's exact ruling, why (verified backend gap), and the precise scope of the backend change added.
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala` — `CreatePipelineStepRequest` gains `attachAsTail: Option[Boolean] = None`; `jsonFormat5` -> `jsonFormat6`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — new `attachTailInternal` (genuine branch-attach primitive, distinct from `spliceInsertAtInternal`), implemented as an explicitly-named wrapper around the pre-existing `insertInternalAction` sibling-scoped-append idiom.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `persistNewStep`'s `parentStepId` branch picks `attachTailInternal` vs. `spliceInsertAtInternal` based on `req.attachAsTail`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` — 5 new cases: `attachTailInternal`'s no-reparenting guarantee (+ mutation proof), a childless-anchor edge case, and an explicit `spliceInsertAtInternal` regression guard (+ its own mutation proof).
- `frontend/src/features/pipelines/services/pipelineService.ts` — `createPipelineStep` gains an optional 6th `attachAsTail` param, sent only alongside `parentStepId`.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — new `handleAddTailStep` (optimistic splice + `createPipelineStep(..., attachAsTail: true)`); fixed a real live-caught ordering bug (temp step must splice in right after the anchor's index, not append at the array end, or `buildStepTree` misclassifies tail vs. trunk continuation).
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — new "Add tail step" button + its own `OpDropdown` per trunk card (hidden once that node already has a tail); new `onAddTailStep` prop.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — `baseProps()` gains `onAddTailStep: jest.fn()`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — wires `handleAddTailStep` into `PipelineRiverView`'s new `onAddTailStep` prop.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — new "+ tail" button CSS (token-only, mirrors the gap-insert button).
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — `PipelineDetailPage.css` baseline shifted +33 for every entry at/after the new CSS block's insertion point (offset arithmetic from `git diff --unified=0`).
- `e2e/hel908-tail-attach.spec.ts` — new: live proof (two trunk steps, tail off the first, assert nested not a third trunk card, survives reload).
- `e2e/hel908-trunk-reorder-order.spec.ts` — new: live proof that `PUT /steps/order` is a no-op for trunk-to-trunk reorder, `test.fail()`-annotated (closes the "count not order" coverage gap regardless of the escalation's resolution).
- `openspec/changes/pipeline-page-outputs-rebuild/{tasks.md,execution-progress.md,files-modified.md}` — Cycle 8 progress; tasks 3.4/3.5 updated to reflect the shipped tail-attach primitive/UI and the escalated reorder finding; task 5.6 unblocked-but-not-done note.

## Cycle 9 additions (Output editor migration, section 5)

- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` — new: the Output editor sheet (task 5.1), all 6 kinds.
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx` — new: per-kind presentational field groups (5.2/5.3/5.4).
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts` (+ `.test.ts`) — new: pure Save config-assembly, unit-tested.
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — new: per-kind config read/shape helpers, capabilities-driven field options.
- `frontend/src/features/pipelines/ui/outputEditor/useOutputTableColumns.ts` (+ `.test.ts`) — new: table column visibility/order state, unit-tested.
- `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx` — new: live preview reusing `ChartRenderer`/`MetricRenderer`; HEL-629 fix (5.8).
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css` — new: sheet-specific chrome.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — replaced the `handleOpenOutput`/`handleAddOutput` toast stubs with real sheet open/close state.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — renders `<OutputEditorSheet>`; gallery's "+ New output" now opens with no pre-chosen step.

## Cycle 9 (human ruling on Cycle 8's trunk-reorder escalation: "the tail follows its trunk step")

- `openspec/changes/pipeline-page-outputs-rebuild/design.md` — "Non-goal waiver #2" subsection (trunk-relink primitive, scoped per the human's ruling) + Decision 15 (the `PUT /steps/order` trunk-only request-shape contract, chosen and justified).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — new `reorderTrunkInternal` (relinks the trunk's `parentStepId` chain; tail rows untouched by construction) + `validateTrunkReorderRequest` (rejects non-trunk-permutation requests with a named violation).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `reorderSteps` repointed at `reorderTrunkInternal`; 422s surface the repository's named-violation message instead of the old whole-pipeline-permutation check.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` — 7 new mutation-proven cases: actual permutation (+ `reorderInternal` no-op mutation proof), tail-travels-with-node, old-slot non-inheritance, no-tail regression guard, and 3 rejection cases (tail id present, trunk id missing, duplicate trunk id).
- `frontend/src/features/pipelines/state/stepTree.ts` — new `reorderTrunk` helper: permutes the trunk, relinks each trunk node's local `parentStepId` to match (client-side mirror of the backend primitive, needed since `buildStepTree` keys topology off `parentStepId`, not array position), and re-flattens with each node's tail carried by node id.
- `frontend/src/features/pipelines/state/stepTree.test.ts` — 4 new `reorderTrunk` cases including a mutation proof against a naive flat `moveStep`.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — fixed a real bug found alongside the fix: drag-drop/Move-up-down used to call `moveStep` directly on the FLAT array using TRUNK-relative indices, silently mismatched the instant any pipeline had a tail; now uses `reorderTrunk` via a `stepTreeRef`. Removed the now-dead `moveStep` helper and `stepsRef`.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — `handleReorderSteps` now derives the persisted request from `buildStepTree(newOrder).trunk` (trunk-only ids), not a raw "every non-temp id" filter, matching the new backend contract.
- `e2e/hel908-trunk-reorder-order.spec.ts` — `test.fail()` annotation REMOVED and the spec re-run to confirm it is GREEN for real; also fixed a genuine test race (the second "Move step up" click needs the first optimistic re-render to commit before it re-resolves its locator).
- `e2e/hel908-trunk-reorder-drag.spec.ts` — new: live proof of the actual HTML5 drag gesture (not the Move button, not a direct API probe) moving a tailed trunk node, confirming the tail travels with it and the old-slot occupant does not inherit it, surviving reload.

## Cycles 10-11 (not logged here by their executors — see execution-progress.md for their file-level detail; sections 6-10 shape-expand/new-pipeline-flow/header/OpenSpec deltas)

## Cycle 12 (replacement executor — task 5.6, 9.1, 9.2, 9.3, final tasks.md/PR-notes pass)

- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts` — new `canAddAsTailWithAggregate`/`buildAggregateTailConfigs` (task 5.6): derives an `AggregateConfig` from the sheet's chart/metric aggregation fields, plus the resulting Output.config for the new post-aggregation node.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — new `handleAddOutputViaAggregateTail`: sequences step-create (`attachAsTail: true`) + Output-create, with step rollback on Output-create failure.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — wires `onAddAsTailWithAggregate` into `OutputEditorSheet`.
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` — new "Add as tail with aggregate" footer action (task 5.6), rendered only while creating against a real node for chart/metric kinds.
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.test.tsx` — new (task 9.1): capabilities-at-node slot-option coverage + pie<->bar live-switch-does-not-throw coverage.
- `e2e/hel908-full-flow.spec.ts` — new (task 9.3): filter -> aggregate-tail metric Output -> chart Output -> table Output -> dry-run -> live thumbnails -> Output sheet preview, one page, 30 clicks recorded.
- `openspec/changes/pipeline-page-outputs-rebuild/tasks.md` — 5.6/9.1/9.2/9.3 marked done with evidence; 4.3 note clarified as deliberately out of scope for the whole ticket.
- `openspec/changes/pipeline-page-outputs-rebuild/execution-progress.md` — Cycle 12 entry + PR notes draft.

## Cycle 13 (replacement executor — rail-thumbnail staleness fix, no incremental soak per release-context guidance)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — root-cause fix: `handleRunPipeline`/`handleDryRun` now dispatch `previewOutput` for every currently-known Output right after `submitPipelineRun` resolves (the reliable completion signal — its HTTP response already carries the finished run, not merely a kickoff ack); the SSE `onTerminal` handler also re-fetches (covers a run already in flight when the page mounted), now correctly matching BOTH terminal statuses (`succeeded` and `dry_run` — the original attempt only matched `succeeded` and silently missed every dry run, a probe-confirmed second root cause); `handleAddOutputViaAggregateTail` (task 5.6's tail-creation path) now also dispatches `previewOutput` for the newly created Output.
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` — `handleSave`'s create (`isCreate`) branch now dispatches `previewOutput` for the newly created Output's real id right after `createOutput` resolves — the in-sheet live preview during creation is cached under the unsaved `step:<stepId>` key, not the new Output's id, so without this the rail chip stayed at the "—" placeholder until the sheet was reopened once.
- `e2e/hel908-full-flow.spec.ts` — rewrote the create-time and post-dry-run thumbnail assertions to prove the fix live: chips now settle to a real preview WITHOUT any sheet click/reopen (previously the spec clicked+cancelled each chip's sheet as a documented workaround for the bug); added a post-dry-run auto-refresh assertion (same row counts before/after, proving a genuine refresh rather than a lucky leftover value) plus a `Cancel` after the trailing sheet-reopen check.

## Cycle 2 (replacement executor — evaluation-1.md's 8 change requests + 4 non-blocking suggestions)

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — CR1: `attachTailInternal`/`attachTailInternalAction` position now floored at 1 unconditionally (leaf-anchor fix); CR8 non-blocking: `parentStepId` tightened `Option[PipelineStepId]` -> `PipelineStepId`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — updated the sole `attachTailInternal` call site for the non-Optional signature.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` — CR1: replaced the stale "childless anchor -> position 0" expectation with 2 new leaf-anchor tail-attach cases (position 1, and a second tail at position 2).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — CR1: new route-level leaf-anchor `attachAsTail` case.
- `openspec/specs/pipeline-step-reorder/spec.md` + `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-step-reorder/spec.md` (new delta) + `schemas/pipelines/reorder-pipeline-steps-request.schema.json` — CR2: corrected the reorder contract description from the old whole-pipeline-permutation shape to the shipped trunk-only relink-and-position-0 shape.
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — CR3: deleted the dead `fetchDataTypes()` mount effect, unused `dataTypes` destructure, and unreachable `markDataTypeRowsStale` dispatch.
- `frontend/src/features/pipelines/state/outputsSlice.ts` + `outputsSlice.test.ts` — CR5: `EMPTY_OUTPUTS` sentinel fixing `selectOutputsForPipeline`/`selectOutputsByStepId`'s reference instability; `selectOutputsForStep` converted to a memoized `createSelector`; 3 new reference-stability Jest cases.
- `frontend/src/features/pipelines/types/step.ts` + `state/stepNarrowing.ts` + `state/stepTree.ts` + `state/stepTree.test.ts` — CR1 follow-up: threaded `position` onto the UI `Step` type so `buildStepTree`'s single-child branch can disambiguate a leaf-anchor tail from a trunk continuation; 3 new Jest cases.
- `e2e/hel908-full-flow.spec.ts` — CR1: removed the false "only matters with two children" rationalization, asserted the leaf-anchor tail renders with the `--tail` class; also fixed a genuine step-creation-race flake (waits for the create POST before proceeding) found while re-verifying live.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` + `PipelineDetailPage.test.tsx` — CR6: completed the ARIA tabs pattern (id/aria-controls/role=tabpanel/aria-labelledby/roving tabindex + arrow-key nav).
- `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx` + `OutputEditorSheet.css` — CR7: moved 3 static inline styles into real CSS classes.
- `frontend/src/features/pipelines/ui/OutputsRail.css` + `frontend/src/shared/ui/tapTarget.css` + `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — CR4: fixed the mobile touch-target floor (overflow-clipping layout fix, gap raised to `--space-4`, `z-index` on the shared expander pseudo).
- `frontend/src/theme/tokenAuditSweep.css.test.ts` — non-blocking: corrected the "+26" shift comment to the verified "+59".
- `openspec/changes/pipeline-page-outputs-rebuild/tasks.md` — CR8: corrected task 10.4's file-size numbers/provenance for `usePipelineDetailPage.ts`/`OutputEditorSheet.tsx`; corrected task 9.3's stale "30 clicks" to the freshly re-run "25 clicks"; new task entries (2.6, 3.4b, 3.5b, 3.7, 3.8, 10.6) documenting each CR's fix.

## Cycle 3 (replacement executor — evaluation-2.md CR9)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — CR9: new `syncStepsFromServer` helper (re-fetches the full step list via `fetchPipelineSteps(id).unwrap()` and replaces local `steps` wholesale). `handleInsertStep`, `handleAddTailStep`, and `handleAddOutputViaAggregateTail` now call it after their create resolves, instead of patching only the one new/temp element — any of these three can leave OTHER steps' `parentStepId`/`position` stale server-side (a trunk splice-insert reparents an anchor's existing children; a later trunk-append can reparent a tail created by an earlier tail-attach). `handleInstantiateShape` audited and left unchanged with a comment explaining why it carries no such exposure (every non-first create in its loop targets a step the same batch just created).
- `e2e/hel908-tail-attach.spec.ts` — new regression case: leaf-tail-attach followed by a trunk-append, asserting (without any reload) that the tail renders under its true new owner, not the original leaf anchor. Verified red-then-green against the pre-fix code before landing.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — updated the one Jest test whose `getPipelineSteps` mock needed a queued post-insert response to match the new resync-after-create behavior (the mock previously never changed after the initial load, which was unrealistic given the real backend always reflects the create).

## Cycle 4 (replacement executor — evaluation-3.md CR10)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — CR10: `handleDuplicateStep` now calls the existing `syncStepsFromServer()` after `duplicatePipelineStep` resolves, replacing the local `setSteps` splice, mirroring the CR9 fix pattern exactly — `PipelineService.duplicateStep` hits the same server-side `spliceInsertAtInternal` reparenting primitive as a trunk splice-insert, so duplicating a tailed trunk step was rendering the clone as a tail branch and promoting the real tail to a top-level trunk card until reload.
- `e2e/hel908-tail-attach.spec.ts` — new regression case: tail-attach off a leaf trunk step, then duplicate that trunk step, asserting (without any reload) that the clone owns the tail and the tail is not left under the original. Verified red-then-green against the pre-fix code before landing.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — updated the "duplicate splices the clone directly after the original" Jest test (renamed to reflect the resync-based fix) with a queued post-duplicate `getPipelineSteps` mock response, mirroring the fixture-realism fix Cycle 3 made for `handleInsertStep`'s test.
- `openspec/changes/pipeline-page-outputs-rebuild/tasks.md` — new task 3.10 documenting CR10's root cause and fix.
- `openspec/changes/pipeline-page-outputs-rebuild/execution-progress.md` — new Cycle 4 entry with full root-cause restatement across all five step-mutating handlers, and red-then-green verification evidence.

## Cycle 5 (replacement executor — evaluation-4.md CR11, human-scoped final cycle)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — CR11: `handleRemoveStep` now calls the existing `syncStepsFromServer()` after `deletePipelineStep` resolves, in addition to (not replacing) the existing optimistic local filter + revert-on-error. `PipelineStepRepository.deleteInternal` reparents the deleted step's head child onto the deleted step's own parent AND cascade-deletes every other child's entire descendant subtree (tails) — a bare local `.filter()` only ever removed the one clicked element, leaving a cascade-deleted tail rendered as a live, interactable top-level trunk card (a phantom for a permanently deleted row) until a hard reload. Only this one hunk changed; `handleReorderSteps` and the aggregate-tail rollback delete (both cleared as safe by evaluation-4.md's systematic pass) are untouched.
- `e2e/hel908-tail-attach.spec.ts` — new regression case: a trunk step (`Filter`) owning both a head/trunk-continuation child (`Sort`) and a tail (`Group & aggregate`) is removed; asserts, without any reload, that exactly one trunk card remains (the reparented head child) and the cascade-deleted tail is entirely absent from the DOM (not rendered as a phantom trunk card). Verified red-then-green: stashed only the hook fix, confirmed the test fails for the right reason (2 top-level trunk cards instead of 1 — the phantom tail promoted to a trunk card), restored the fix, confirmed green.
- `openspec/changes/pipeline-page-outputs-rebuild/design.md` — new "Step-Mutating Handler Enumeration: the Method" section documenting the CR9/CR10/CR11 postmortem: the original enumeration axis ("does this call create a step?") was wrong; the correct axis is "can this backend route mutate/reparent/delete steps OTHER than the one targeted, and does the frontend handler fully resync or only patch local state for the one step it acted on?" — a durable, repeatable 4-step method for any future step-mutating handler, plus the current (as-of-CR11) enumeration table for reference.

## Final-gate skeptic round 1 (replacement executor — skeptic-final-1/2/3.md)

- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts` — skeptic-final-2 CR1: `handleInstantiateShape` always creates its first step with plain trunk-continuation semantics (never `attachAsTail`); added a defensive `anchorHasTail` refusal (toast + early return) as a backstop if the anchor already has a tail. Removed the old `anchorHasChild`-driven `attachAsTail` logic, which always produced a phantom second tail for the only real anchor this handler is ever fed (trunk-last).
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — skeptic-final-2 CR1: the bottom "Add Outputs from a shape" trigger is now disabled (with a `title`) whenever the trunk-last step already has a tail, computed from `stepTree.tailsByStepId`.
- `frontend/src/features/pipelines/state/stepTree.test.ts` — new regression test documenting the `hasTail`/single-tail invariant the handler/UI-layer fix above relies on.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — new "trunk-last-tail gate" describe block asserting the trigger is enabled/disabled correctly.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — new page-level integration test for the same gate, plus one line removed from a `PipelineSummary` fixture (see below).
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx` — skeptic-final-3 CR1/CR2: Delete/Cancel/Save footer buttons now use the shared `ui-modal-btn ui-modal-btn--{danger,secondary,primary}` recipe instead of a bare/unstyled `<button>`. skeptic-final-3 CR6: `panel-detail-modal__*` classNames renamed to this component's own `output-editor-sheet__*`. File-size header comment corrected to the real, fresh `wc -l` count.
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx` / `OutputPreviewPane.tsx` — skeptic-final-3 CR6: same `panel-detail-modal__*` → `output-editor-sheet__*` className rename (these two files don't own their own stylesheet; they share `OutputEditorSheet.css`, which now defines the renamed classes).
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css` — skeptic-final-3 CR1/CR2/CR6: added this component's own `output-editor-sheet__{data-section,data-label,edit-section-heading,field-hint,type-hint,mapping-row,mapping-label}` rules (ported byte-for-byte from `panel-detail-modal__*`, no longer imported cross-feature); simplified `.output-editor-sheet__delete` to just the footer-left placement now that the color/recipe lives in the shared `ui-modal-btn--danger` class.
- `frontend/src/shared/ui/Modal.css` — skeptic-final-3 CR1/CR2: new `.ui-modal-btn--danger` variant (DESIGN.md's Danger recipe, matching `.ui-icon-btn--danger`), the first `ui-modal-btn` consumer needing a destructive footer action.
- `frontend/src/features/pipelines/ui/OutputGalleryCard.css` — skeptic-final-3 CR4: replaced the invented `--app-surface-sunken` (defined nowhere, silently falling back to the HOVER rung) with the real recessed-well token, `--app-surface-soft`.
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx` — skeptic-final-1 CR1: deleted the dead "Output type" `<th>`/`<td>` (backend never sends `outputDataTypeName`).
- `frontend/src/features/pipelines/types/pipelineStep.ts` — skeptic-final-1 CR1: removed the now fully-dead `outputDataTypeName: string` field from `PipelineSummary` (kept `outputDataTypeId?`, still read by the HEL-937-blocked provenance map).
- `frontend/src/app/App.test.tsx`, `frontend/src/features/panels/ui/PanelCreationModal.test.tsx`, `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.test.tsx`, `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`, `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`, `frontend/src/features/pipelines/ui/PipelineListTable.test.tsx`, `frontend/src/features/pipelines/ui/PipelinesPage.test.tsx`, `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.test.tsx`, `frontend/src/features/proposals/state/combinedProposalsSlice.test.ts`, `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx`, `frontend/src/shared/chrome/SidebarBody.test.tsx` — removed the now-invalid `outputDataTypeName` line from every `PipelineSummary` fixture object (a request-payload `outputDataTypeName`, a genuinely different field, is left untouched where it appears).
- `openspec/changes/pipeline-page-outputs-rebuild/tasks.md` — corrected task 8.3's false "backend still returns it for legacy pipelines" claim; re-measured and corrected task 10.4's file-size numbers.
- `openspec/changes/pipeline-page-outputs-rebuild/design.md` — decision 13 annotated: the `ShapeParamDescriptor` follow-up ticket it says "SHALL be filed at delivery time" was verified NOT filed; still not filed this round (no Linear-write tool access).
- `openspec/changes/pipeline-page-outputs-rebuild/execution-progress.md` — new round-1 entry summarizing all three skeptics' REFUTE findings and fixes.
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-1.md`, `skeptic-final-2.md`, `skeptic-final-3.md` — moved into git tracking (were untracked at the start of this round).

## Full declared file list (orchestrator, pre-squash reconciliation)

Per-cycle narrative entries above didn't consistently use the backtick-bullet
format `squash-branch.sh` parses, and some files touched across 13+ executor
cycles were never re-declared after later fix cycles touched them again. This
section is the authoritative, mechanically-generated full list (`git diff
--cached --name-only` against `main` at squash time) so the guard has a
complete allowlist rather than a partial, hand-maintained one.

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineStepProtocol.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala`
- `e2e/hel908-full-flow.spec.ts`
- `e2e/hel908-step-card-split.spec.ts`
- `e2e/hel908-tail-attach.spec.ts`
- `e2e/hel908-trunk-reorder-drag.spec.ts`
- `e2e/hel908-trunk-reorder-order.spec.ts`
- `frontend/src/app/App.test.tsx`
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.test.tsx`
- `frontend/src/features/panels/ui/creationSteps/ShapeInstantiateStep.tsx`
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelineDetailPage.ts`
- `frontend/src/features/pipelines/hooks/usePipelinePreviewCache.test.tsx`
- `frontend/src/features/pipelines/hooks/usePipelinePreviewCache.ts`
- `frontend/src/features/pipelines/hooks/useStepCardPreview.ts`
- `frontend/src/features/pipelines/services/outputService.ts`
- `frontend/src/features/pipelines/services/pipelineService.ts`
- `frontend/src/features/pipelines/state/outputsSlice.test.ts`
- `frontend/src/features/pipelines/state/outputsSlice.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`
- `frontend/src/features/pipelines/state/pipelinesSlice.ts`
- `frontend/src/features/pipelines/state/stepNarrowing.ts`
- `frontend/src/features/pipelines/state/stepTree.test.ts`
- `frontend/src/features/pipelines/state/stepTree.ts`
- `frontend/src/features/pipelines/types/output.ts`
- `frontend/src/features/pipelines/types/pipelineShape.ts`
- `frontend/src/features/pipelines/types/pipelineStep.ts`
- `frontend/src/features/pipelines/types/step.ts`
- `frontend/src/features/pipelines/ui/CreatePipelineModal.css`
- `frontend/src/features/pipelines/ui/CreatePipelineModal.test.tsx`
- `frontend/src/features/pipelines/ui/CreatePipelineModal.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.test.ts`
- `frontend/src/features/pipelines/ui/outputEditor/buildOutputConfig.ts`
- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.css`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.test.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputKindFields.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/OutputPreviewPane.tsx`
- `frontend/src/features/pipelines/ui/outputEditor/useOutputTableColumns.test.ts`
- `frontend/src/features/pipelines/ui/outputEditor/useOutputTableColumns.ts`
- `frontend/src/features/pipelines/ui/OutputGalleryCard.css`
- `frontend/src/features/pipelines/ui/OutputGalleryCard.tsx`
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.css`
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.test.tsx`
- `frontend/src/features/pipelines/ui/OutputsGalleryTab.tsx`
- `frontend/src/features/pipelines/ui/OutputsRail.css`
- `frontend/src/features/pipelines/ui/OutputsRail.test.tsx`
- `frontend/src/features/pipelines/ui/OutputsRail.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailHeader.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`
- `frontend/src/features/pipelines/ui/PipelineListTable.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineListTable.tsx`
- `frontend/src/features/pipelines/ui/PipelinePreviewModal.css`
- `frontend/src/features/pipelines/ui/PipelinePreviewModal.test.tsx`
- `frontend/src/features/pipelines/ui/PipelinePreviewModal.tsx`
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx`
- `frontend/src/features/pipelines/ui/PipelinesPage.test.tsx`
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.test.tsx`
- `frontend/src/features/pipelines/ui/shapes/ShapeParamsFields.tsx`
- `frontend/src/features/pipelines/ui/shapes/ShapePickerModal.test.tsx`
- `frontend/src/features/pipelines/ui/shapes/ShapePickerModal.tsx`
- `frontend/src/features/pipelines/ui/StepCard.test.tsx`
- `frontend/src/features/pipelines/ui/StepCard.tsx`
- `frontend/src/features/pipelines/ui/StepOpEditor.tsx`
- `frontend/src/features/pipelines/ui/TailChain.tsx`
- `frontend/src/features/proposals/state/combinedProposalsSlice.test.ts`
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx`
- `frontend/src/features/sources/ui/AddSourceModal.tsx`
- `frontend/src/shared/chrome/SidebarBody.test.tsx`
- `frontend/src/shared/ui/Modal.css`
- `frontend/src/shared/ui/tapTarget.css`
- `frontend/src/store/store.ts`
- `frontend/src/theme/tokenAuditSweep.css.test.ts`
- `openspec/changes/pipeline-page-outputs-rebuild/design.md`
- `openspec/changes/pipeline-page-outputs-rebuild/evaluation-1.md`
- `openspec/changes/pipeline-page-outputs-rebuild/evaluation-2.md`
- `openspec/changes/pipeline-page-outputs-rebuild/evaluation-3.md`
- `openspec/changes/pipeline-page-outputs-rebuild/evaluation-4.md`
- `openspec/changes/pipeline-page-outputs-rebuild/evaluation-5.md`
- `openspec/changes/pipeline-page-outputs-rebuild/execution-progress.md`
- `openspec/changes/pipeline-page-outputs-rebuild/files-modified.md`
- `openspec/changes/pipeline-page-outputs-rebuild/.openspec.yaml`
- `openspec/changes/pipeline-page-outputs-rebuild/proposal.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-design-1.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-design-2.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-design-3.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-design-4.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-design-5.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-1.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-2.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-3.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-5.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-6.md`
- `openspec/changes/pipeline-page-outputs-rebuild/skeptic-final-scope-round2.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/data-grid/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-create-modal/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-editor-page/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-new-flow/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-outputs-gallery/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-output-sheet/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-outputs-rail/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-output-type-selector/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-shape-instantiation-ui/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-step-reorder/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/specs/pipeline-tails-ui/spec.md`
- `openspec/changes/pipeline-page-outputs-rebuild/tasks.md`
- `openspec/changes/pipeline-page-outputs-rebuild/ticket.md`
- `openspec/specs/pipeline-step-reorder/spec.md`
- `schemas/pipelines/create-pipeline-step-request.schema.json`
- `schemas/pipelines/reorder-pipeline-steps-request.schema.json`
