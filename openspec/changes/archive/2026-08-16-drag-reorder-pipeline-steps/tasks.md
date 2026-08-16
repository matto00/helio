# Tasks: drag-reorder-pipeline-steps

## 1. Backend — atomic reorder endpoint

- [x] 1.1 Add `ReorderPipelineStepsRequest(stepIds: Seq[String])` + `jsonFormat1` to `PipelineStepProtocol.scala`; export via `api/package.scala` as the siblings are
- [x] 1.2 Add `PipelineStepRepository.reorderInternal(pipelineId, orderedIds)`: single transactional DBIO setting `position = index` per id
- [x] 1.3 Add `PipelineService.reorderSteps(pipelineId, req, user)`: editor/owner ACL + NotFound masking (mirror `updateStep`), 422 on non-permutation (set equality + length), returns full reordered step list
- [x] 1.4 Wire `PUT pipelines/:id/steps/order` into `PipelineStepRoutes.scala` (thin shell; no inline FQNs)
- [x] 1.5 Add `schemas/reorder-pipeline-steps-request.schema.json`; keep `npm run check:schemas` green
- [x] 1.6 Backend tests in `PipelineStepRoutesSpec.scala`: 200 happy path (order persisted, positions reindexed 0..n-1), 404 unknown/invisible pipeline, 403 viewer, 422 missing/unknown/duplicate ids, failed-reorder-leaves-positions-unchanged

## 2. Frontend — reorder UX + persistence

- [x] 2.1 Add `reorderPipelineSteps(pipelineId, stepIds)` to `pipelineService.ts` (PUT, returns `PipelineStep[]`)
- [x] 2.2 Add `handleReorderSteps(newOrder)` to `PipelineDetailPage.tsx` (design Decision 7): snapshot prev order → optimistic `setSteps` → plain service call with persisted ids only (exclude `step-N` temp ids) → reconcile from response on success → revert + `pushToast` on failure; thread it into `PipelineRiverView`
- [x] 2.3 `StepCard.tsx`: restructure the header per design Decision 4 — wrapper `<div>` with the existing expand-toggle `<button>` (content/semantics unchanged, `flex: 1`) plus a sibling actions cluster (drag handle + Move up/Move down buttons, `SidebarItemList.renderRowAction` precedent, no `stopPropagation`)
- [x] 2.4 `PipelineRiverView.tsx`: native HTML5 drag orchestration — pass `onStepDragStart(index)`/`onStepDragEnd()` props to StepCard (drag handle is the sole draggable element); `onDragOver`/`onDrop` + `overIndex` state + drop-indicator line on the card-wrapper divs; compute the new stepId order on drop; Move up/down invokes the same handler with adjacent transposition
- [x] 2.5 Drop-indicator + drag-state + header/actions-cluster CSS in `PipelineDetailPage.css`, token-only per `DESIGN.md`
- [x] 2.6 `StepCard.tsx`: add `stepIndex: number` prop (RiverView passes its map index) and extend the preview-refresh fingerprint to `` `${stepIndex}:${JSON.stringify(step.config)}` `` (Decision 9)

## 3. Tests

- [x] 3.1 PipelineDetailPage handler tests: optimistic reorder renders immediately; service called with persisted ids only (temp `step-N` excluded); success reconciles persisted entries from the response by id (temp `step-N` steps stay in place, never disappear); failure reverts to prior order and surfaces a toast
- [x] 3.2 RiverView/StepCard tests: drop handler computes correct id order; Move up/down transpose and disable at ends; reorder invokes the `handleReorderSteps` callback with the correct new order; clicking Move up/down does NOT toggle expand/collapse (sibling-not-nested regression guard); expand toggle keeps `aria-expanded` + keyboard activation after the header restructure
- [x] 3.3 Analyze-refresh test: reordered steps change `stepsFingerprint` → debounced `analyzePipeline` dispatch (existing mechanism, assert it fires)
- [x] 3.4 StepCard preview test: `stepIndex` change while preview open triggers exactly one debounced re-fetch; closed preview unaffected
- [x] 3.5 Record file growth + budget notes in `files-modified.md`
- [x] 3.6 Run gates: backend `sbt test`; frontend `npm run lint`, `npm run format:check`, `npm test`; `npm run check:schemas` — all clean
