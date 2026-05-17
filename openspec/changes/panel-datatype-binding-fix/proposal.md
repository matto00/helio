# Panel ↔ DataType binding fix — HEL-242

## Why

A panel bound to a populated DataType **sometimes** does not render its rows. This breaks the product's core promise (`DataSource → Pipeline → DataType → Panel`) and is filed P0 on the v1.5 Panel System v2 epic.

Cycle-1 investigation has refuted the carried hypothesis (cross-user binding scrub in `PanelService.resolveSingleBinding`) as the source of the bug in matt's normal usage: matt's bound panels resolve through `dataTypeRepo.findById(typeId, ownerId)` successfully because matt is the owner of both his panels and the DataTypes they bind to. A direct `GET /api/dashboards/:id/panels` request against the live dev DB confirms `dataTypeId` is preserved on every one of matt's bound panels.

What cycle-1 did find is a different (deterministic) gap that fully explains the "sometimes doesn't render" reports: **after a pipeline run completes, the dashboard view holds onto its stale `paginationState[panelId]` indefinitely.** There is no mechanism — SSE listener, cache-key change, manual refresh affordance, or page-level invalidation — that re-fetches `/api/types/:id/rows` after a successful run unless the user navigates to a different dashboard and back **and** the `markDashboardPanelsStale` action has fired (which only happens on panel create / delete / duplicate, not on pipeline-run completion). The `usePanelPolling` hook would cover this, but it depends on `panel.refreshInterval`, which is documented frontend-only and is therefore `null` for every panel hydrated from the backend.

The "sometimes" in the bug report maps to which page the user is on when the pipeline runs (PipelineDetailPage refreshes its own history but never the panels), whether they reload the browser, and whether their session has the cached entry. Same panel, same DataType, same browser session = stale view; new tab or reload = fresh view.

## What changes

Cycle 2 will:

1. **Invalidate pagination state when a panel's DataType receives a successful pipeline run.** Add a `markDataTypeRowsStale(dataTypeId)` action that the pipeline-run terminal hook dispatches; the panels reducer clears every `paginationState[panelId]` whose underlying panel binds that DataType, which forces `usePanelData` to re-fetch on its next effect tick.
2. **Wire the `PipelineDetailPage` SSE `onTerminal` callback to dispatch the new action** when the run status is `succeeded` (failed runs intentionally do not invalidate — `overwriteRows` is transactional, so a failed run did not touch persisted rows).
3. **Add a regression test** — a Jest integration-shaped test on `usePanelData` + the new action verifying that dispatching `markDataTypeRowsStale(typeId)` for a panel's bound DataType causes a re-fetch on the next effect tick.

Out of scope for this change (file as spinoff tickets):

- Cross-tab / multi-user invalidation (this fix only covers the same browser session)
- A general resource-bus / event-stream for `/api/dashboards/:id/panels` reloads
- Backend SSE channel keyed by `dataTypeId` for cross-page invalidation
- Persisting `refreshInterval` (referenced in `panel.ts` comment as "until CS3 removes it") — this is a separate axis
- The cross-user binding scrub in `PanelService.resolveSingleBinding` (left intact; the cycle-1 investigation confirmed it is not the cause of the symptom in normal usage, and changing its behavior would require ACL review)

## Impact

- **`frontend/src/features/panels/state/panelActions.ts`** — add `markDataTypeRowsStale` action
- **`frontend/src/features/panels/state/panelsSlice.ts`** — add the matching reducer case that clears `paginationState` for every panel matching the affected `dataTypeId`
- **`frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`** — dispatch the new action from the SSE `onTerminal` callback on `succeeded`
- **`frontend/src/features/panels/hooks/usePanelData.test.ts`** — new test case
- **No backend changes.** No schema changes. No wire-shape changes.

Estimated surface: ~40 LOC frontend, ~30 LOC test.
