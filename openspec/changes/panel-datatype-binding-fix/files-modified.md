# Files modified — HEL-242 cycle 2

Production code (4 files):

- `frontend/src/features/panels/state/panelActions.ts` — new `markDataTypeRowsStale(dataTypeId)` action (+7 LOC).
- `frontend/src/features/panels/state/panelsSlice.ts` — import `markDataTypeRowsStale` + `isBoundCapablePanel`; new `extraReducers` case that walks `state.items`, narrows via the helper, and deletes matching `paginationState[panel.id]` entries; re-exported from the public surface (+13 LOC).
- `frontend/src/features/panels/hooks/usePanelData.ts` — dedupe guard now bypasses the early-return when `paginationEntry == null`; `paginationEntry` added to the effect deps array (+4 net LOC).
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — import `markDataTypeRowsStale` from the panels slice; SSE `onTerminal` dispatches it when `event.status === "succeeded"` and `currentPipeline?.outputDataTypeId` is non-null (+10 LOC).

Tests (2 files):

- `frontend/src/features/panels/state/panelsSlice.test.ts` — three reducer cases for `markDataTypeRowsStale` (selective clear, no-match no-op, ignores text-panel subtypes that carry no binding) (+80 LOC).
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — two integration-shape cases (dispatching the action for the panel's bound DataType triggers a refetch; dispatching for an unrelated DataType does not) (+60 LOC).

OpenSpec docs (no code impact):

- `openspec/changes/panel-datatype-binding-fix/tasks.md` — cycle-2 task boxes ticked.
- `openspec/changes/panel-datatype-binding-fix/executor-report-2.md` — cycle-2 report.
- `openspec/changes/panel-datatype-binding-fix/files-modified.md` — this file.
- `openspec/changes/panel-datatype-binding-fix/workflow-state.md` — phase bump.

No backend files touched. No schemas touched. No Flyway migrations. No HTTP contract changes.
