- `backend/src/main/scala/com/helio/domain/panels/FormPanel.scala` — `FormPanelConfig.isCompactCounter` (twin of the client's `isCompactCounterConfig`)
- `backend/src/main/scala/com/helio/services/panels/FormPlacementRule.scala` — new: `FormMinRows = 5`, `minRowsFor(panel)`, `isSpaceBelowFree` (mirror of the client's)
- `backend/src/main/scala/com/helio/services/panels/CreatePlacement.scala` — `duplicateSizes(..., minH)` floors every breakpoint's height
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelMutationRepository.scala` — `duplicate` derives `minH` from the in-transaction source row (design gate note b); `PanelLifecycleWrites.duplicatePlaced` needed no change
- `backend/src/main/scala/com/helio/services/proposals/ProposalLayoutSupport.scala` — `buildLayout(minRows)` lift-when-free on authored lg items, before unauthored items are appended
- `backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala` — `applyLayout` passes `minRowsFor` of each created panel
- `backend/src/main/scala/com/helio/services/dashboards/DashboardContentsService.scala` — `buildAndReplace` passes `minRowsFor` of each built panel (PUT /contents, owner ruling)
- `backend/src/test/scala/com/helio/api/routes/panels/FormMinRowsPathsSpec.scala` — route-level red-first tests per path, compact-counter and neighbour-below cases, GUARD tests for import and dashboard duplicate
- `backend/src/test/scala/com/helio/services/panels/FormPlacementRuleSpec.scala` — predicate and rule unit table
- `backend/src/test/scala/com/helio/services/panels/CreatePlacementSpec.scala` — `duplicateSizes(minH)` cases
- `backend/src/test/scala/com/helio/services/proposals/ProposalLayoutSupportMinRowsSpec.scala` — `buildLayout(minRows)` cases
- `openspec/changes/form-min-rows-duplicate-proposal/evidence/*.txt` — red run, mutation runs, green runs

## Callers (task 2.5)

- `ProposalLayoutSupport.buildLayout`: exactly `DashboardProposalService.applyLayout` and `DashboardContentsService.buildAndReplace` (both pass `minRows`), plus `FirstRunLayoutValiditySpec` (a test, default no floor, unchanged and green).
- `CreatePlacement.duplicateSizes`: exactly `PanelMutationRepository.duplicate` (passes `minH`) plus `CreatePlacementSpec`.

## Combined-proposal apply (design gate note a)

Confirmed by reading the code: the combined (pipeline + dashboard) apply creates the dashboard through `DashboardProposalService.apply`, which ends in `applyLayout` -> `ProposalLayoutSupport.buildLayout`; it inherits the lift with no separate change. The route test exercises `POST /api/dashboards/apply-proposal`, the same `applyLayout`.

## Out of scope, so the path enumeration is visibly complete

- Patch-set dashboard `layout` patch, and the patch-set undo `RestorePriorStored` restore (`PatchSetUndoRestorers`): they edit or restore a saved layout and place no new panel; they belong with the client layout PATCH and import (saved layouts stay as saved).
- Dashboard import (`DashboardSnapshotRepository.importSnapshot`, `remapLayoutItem`) and dashboard duplicate (`DashboardSnapshotRepository.duplicate`, `remapItems`): owner rulings; pinned by GUARD tests, each shown red by a mutation of its own remap (`evidence/mutations.txt`, `guard-import`, `guard-dashdup`).
- Single/batch/patch-set panel create (`PlacementSizes.forNewPanel`, already 5 rows) and auto-layout (`PanelPacker`, form minH 5): already correct.
