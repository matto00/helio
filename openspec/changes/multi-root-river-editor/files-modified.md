# Files modified — HEL-968 multi-root river editor

## Core lane-graph data layer (D1/D2/D3)

- `frontend/src/features/pipelines/state/stepTree.ts` — `buildLaneGraph(steps, roots)` now takes the pipeline's `roots[]` as a required parameter (D1), seeding one lane per root (in `roots` order) from that root's own root-level steps, replacing the old "first parentless step is the root" heuristic that structurally dropped every second root. `Lane` gained `rootId`; `LaneGraph.primaryLaneId` removed. `flattenLaneGraph` now emits every root's own lane (in root order) instead of assuming one. A root with zero steps still gets an (empty) placeholder lane.
- `frontend/src/features/pipelines/state/stepTree.test.ts` — rewritten for the new signature; added coverage for a second root's lane no longer being dropped, an empty root still producing a lane, and single-root pipelines being unchanged.
- `frontend/src/features/pipelines/state/laneLayout.ts` — `computeLaneLayout` groups columns by root position first (D2, `computeColumnOrder` helper), then by the existing sibling order within a root. `laneOutputSubtitle`'s `primaryLaneId` reference replaced with the equivalent `parentStepId === undefined` check.
- `frontend/src/features/pipelines/state/laneLayout.test.ts` — updated for the new `buildLaneGraph` signature; added D2 root-grouping coverage (determinism across roots, contiguous root-1-after-root-0 column ordering even with root-0 branch lanes).
- `frontend/src/features/pipelines/state/nodePath.ts` (new) — `nodePath(stepId, steps, roots)`: the R5 runtime graph path (`root:<rootId> > s1 > s4`), traversing `parentStepId` and lane-kind `secondaryInput` edges, resolving a multi-root-reachable node through the lowest-positioned root (R5 canonical tiebreak).
- `frontend/src/features/pipelines/state/nodePath.test.ts` (new) — format, canonical-tiebreak, and "never the stale bare-`root` head" coverage (AC3).

## Wire-shape threading (task 2)

- `frontend/src/features/pipelines/types/pipelineStep.ts` — added `rootId?: string | null` to `BasePipelineStep` (the backend has sent it on every step response since HEL-913 task 7.6a; the frontend wire type had never caught up — verified against the running backend, task 2.3/7.2). Added `RemovePipelineRootResponse`.
- `frontend/src/features/pipelines/types/step.ts` — added `rootId?: string` to the UI `Step` type.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `pipelineStepToStep` carries `rootId` through instead of discarding it.

## Root columns, "+ root", root removal (tasks 6, 8, 9)

- `frontend/src/features/pipelines/ui/RootColumn.tsx` (new) — one column per non-primary root: header (dataSourceName + Remove button), reuses `LaneColumn` for the root's own steps, or an empty-lane affordance when it has none (task 6.2). No root styled/labelled primary (R3/task 6.3).
- `frontend/src/features/pipelines/ui/AddRootModal.tsx` (new) — "+ root" (D4): existing-source picker + nested `AddSourceModal`, mirroring `CreatePipelineModal`'s composition. Confirm control disabled on an unset id AND the handler refuses independently (HEL-620 double-guard).
- `frontend/src/features/pipelines/ui/AddRootModal.test.tsx` (new) — HEL-620 regression guard (asserts on the service spy, not the disabled attribute) plus the happy path.
- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — accepts `roots`/`onAddRoot`/`onRemoveRoot`; root 0 keeps the existing top-level river treatment (drag reorder, gap-insert, Move up/down — R3 sanctions this UI privilege), roots[1..] render via `RootColumn`, plus a trailing "+ Add root" affordance. `primaryLaneId` references replaced with root-0-scoped lane lookups.
- `frontend/src/features/pipelines/ui/PipelineRiverView.test.tsx` — updated fixtures for the new `buildLaneGraph` signature/`roots` prop; added root-column rendering, remove-root, and "+ Add root" modal coverage.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` / `usePipelineDetailPage.ts` — thread `roots`/`handleAddRoot`/`handleRemoveRoot` from the hook to the view. `handleAddRoot` calls `addPipelineRoot` then refetches the pipeline; `handleRemoveRoot` calls `removePipelineRoot`, resyncs pipeline + steps, and surfaces the server's exact `removedStepCount`/`removedOutputCount` (or its named refusal) via toast — never re-derived client-side (D5).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added root-removal coverage (AC2 second half): success surfaces the server's counts; a named refusal (e.g. last root) renders verbatim.
- `frontend/src/features/pipelines/services/pipelineService.ts` — added `addPipelineRoot`/`removePipelineRoot` (task 7.1, verified against the running backend). `createPipelineStep` gained a trailing `rootId` parameter (see "Wire-shape defect found" below).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css` — root-column layout/header/empty-state/remove-button/add-root-button styles; stacking rules added to the existing phone-breakpoint media block (D6, task 10.1). Touch targets (`+ Add root`, remove) are real rendered boxes (`min-height`/`min-width: 44px` plus padding), not a hit-expander trick — verified via Playwright `boundingBox()` at 375px/430px (task 10.2), not just the CSS declaration.

## Consumers fixed for the D1 signature/type changes

- `frontend/src/features/pipelines/ui/OutputsGalleryTab.tsx` — `buildLaneGraph` fallback path derives a synthetic root list from `steps` themselves (this component's only use of the fallback is lane-subtitle lookups, never column order).
- `frontend/src/features/pipelines/utils/proposalLaneGraph.ts` — adapted to the new `buildLaneGraph(steps, roots)` signature; synthesizes root ids from `PipelineProposalSource[]` (a proposal's roots have no persisted id yet). Out of scope otherwise (HEL-914 owns proposal branching).
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalSummary.tsx` — `primaryLaneId` reference replaced with the `parentStepId === undefined` check; `buildProposalLaneGraph` call site updated.

## Wire-shape defect found and fixed (task 2.3/7.2 — proven against the running app, not typecheck)

`createPipelineStep`'s frontend service call never sent `rootId`, so every root-level step-create against a >1-root pipeline 400'd server-side ("This pipeline has N roots — name one via rootId, or anchor via parentStepId") — the backend already supported `CreatePipelineStepRequest.rootId`; only the frontend had never caught up. Found and fixed live via the Playwright E2E run (AC1), not by any static gate. Fixed in `pipelineService.createPipelineStep` (new trailing `rootId` param) and its three root-level call sites in `usePipelineDetailPage.ts` (`handleInsertStep`, `handleInstantiateShape`'s anchorless case; `handleAddOutputViaAggregateTail` always has a real `parentStepId` and is unaffected). `PipelineDetailPage.test.tsx`'s existing `createPipelineStepMock` assertions updated for the new trailing argument.

## Incidental fix required by the CSS change

- `frontend/src/theme/tokenAuditSweep.css.test.ts` — a pre-existing, line-number-pinned regression-guard baseline for `PipelineDetailPage.css`; updated the ~40 shifted line numbers (content verified byte-identical at each old→new line via diff) after this change's ~110-line CSS insertion. Not a sibling-owned file (HEL-844/HEL-970/HEL-893 own disjoint areas); this is an unavoidable consequence of editing a file this shared regression guard already covers.

## Skeptic-final-1 fix (AC3 — `nodePath()` was dead code)

`nodePath()` (D3) had zero call sites outside its own unit test — nothing rendered a lane path anywhere, old or new format. Wired it in:

- `frontend/src/features/pipelines/ui/PipelineRiverView.tsx` — computes `nodePathByStepId` once (`useMemo` over `steps`/`roots`) and applies it as each step's `title` attribute (both the primary-lane wrapper and every `RootColumn`/`LaneColumn`-rendered step), so a path only ever gets constructed at this one call site.
- `frontend/src/features/pipelines/ui/LaneColumn.tsx` / `RootColumn.tsx` — thread the `nodePathByStepId` lookup straight through (mirrors the existing `outputsByStepId` convention) and apply it as a `title` on each step wrapper (both the compact tail-chain and full-card renderings).

Verified: `grep -rn "nodePath(" frontend/src/features/pipelines --include=*.tsx --include=*.ts | grep -v test` now returns a real, non-test call site (`PipelineRiverView.tsx:294`). Confirmed live in the running app (two-root pipeline, a root-level step's `.pipeline-detail-page__step-section` `title` attribute reads `root:<rootId> > <stepId>`) — then removed the scratch verification spec (not a permanent regression test).

## Openspec artifacts

- `openspec/changes/multi-root-river-editor/tasks.md` — all 37 tasks marked complete.

## Not touched (confirmed)

- `backend/**`, `schemas/**` — zero diff (`git diff --name-only main... -- backend/ schemas/` returns nothing).
- `backend/src/main/resources/db/migration/**` — zero diff (no Flyway migration).
