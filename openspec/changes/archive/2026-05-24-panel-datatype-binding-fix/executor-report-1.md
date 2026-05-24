# Executor Report — HEL-242 cycle 1 (investigation only)

## 1. Reproduction recipe

**Symptom reproduces deterministically once you understand the trigger** — not "sometimes" intermittent in the random-failure sense, but variable depending on user behavior (refresh vs. no-refresh between actions):

1. Log in as `matt@helio.dev / heliodev123` (live UserId `9532cfcf-9882-45ba-8247-23706bc00113`).
2. Open a dashboard with a bound panel (e.g. dashboard `e44e7c57-aa5e-47bc-8c94-5d299f319024` "Helio is profitable?" → panel `983988f8-...` bound to DataType `38fb6329-...Profit`).
3. The panel says "no data available" — there are no rows in `data_type_rows` for `38fb6329-...`.
4. Without leaving the dashboard, run the upstream pipeline that writes to `38fb6329-...` (via the PipelineDetailPage).
5. Observe: the pipeline-run SSE stream completes with `succeeded`; backend persists rows via `dataTypeRowRepo.overwriteRows`; the panel on the dashboard **does not update** until the user reloads the browser or otherwise causes `paginationState[panelId]` to be cleared.

Verified via direct API probe (curl with bearer token after `POST /api/auth/login` as matt):

- `GET /api/dashboards/e44e7c57-.../panels` returns three panels with `config.dataTypeId = "38fb6329-..."` preserved — the binding is **not** scrubbed.
- `GET /api/types/38fb6329-.../rows` returns `{ rowCount: 0, rows: [] }` (no pipeline has populated this DataType in the dev DB).
- `GET /api/types/21ce4b95-.../rows` (a sibling DataType that did have a successful run) returns 5 rows. Panels bound to it render. The contrast confirms the path works when rows exist; the failure mode is purely the stale-cache axis.

Recreating the "sometimes" axis: open two browser tabs on the same dashboard, run a pipeline in one. Reload one — fresh data; the other — stale forever. Same browser session, same code, two different results.

## 2. Root-cause finding (verified)

**Pipeline-run completion does not invalidate the panels-slice pagination cache.**

After a panel mounts and `usePanelData` fetches rows once, the cache key (`${panelId}|${typeId}|${fieldMappingKey}`) is stored in `prevFetchKey.current`. On every subsequent render the hook sees `prevFetchKey === currentFetchKey` and returns early without re-fetching. The only thing that can change the key is a binding edit (`dataTypeId` or `fieldMapping`), which does not happen on a pipeline run — the row content changes but every panel's binding stays the same.

The Redux `paginationState[panelId]` entry survives:

- `fetchPanels.fulfilled` (panels-list refetch does not clear it)
- `markDashboardPanelsStale` (which only fires on panel create/delete/duplicate, never on pipeline-run completion)
- dashboard remount (the thunk's `condition` skips the refetch when status === succeeded && loadedDashboardId matches)

The only mechanisms that would cause a row refetch are:

- `usePanelPolling` — but it depends on `panel.refreshInterval`, which `frontend/src/features/panels/types/panel.ts:111-114` documents as frontend-only and notes is always `null` for any panel hydrated from the backend
- a binding edit
- a full browser reload

None of these fire automatically after a pipeline run.

The `PipelineDetailPage` SSE hook's `onTerminal` callback dispatches exactly one action: `fetchPipelineRunHistory(id)`. It does not touch the panels slice, the dashboards slice, or the data-types slice. The cross-page invalidation channel does not exist.

## 3. Hypothesis verdict — REFUTED

The recorded hypothesis (cross-user binding scrub in `PanelService.resolveSingleBinding` causing cache-key oscillation):

- **Internally inconsistent**: the scrub is deterministic for a given (panel, user) pair — the user's id and the DataType's owner are stable across requests. After a scrub, every subsequent GET also scrubs; the cache key would settle to `null` (early-return, "no data" rendered deterministically), not oscillate.
- **Empirically refuted for matt's normal flow**: matt's bound panels and bound DataTypes are all owned by matt (verified by SQL JOIN on the live dev DB); `dataTypeRepo.findById(typeId, ownerId)` returns the DataType; `resolveSingleBinding` returns the panel unchanged; `GET /api/dashboards/:id/panels` preserves the `dataTypeId` field on the wire (verified by curl).

The hypothesis points at a real (small) latent issue — the scrub IS reachable for two edge cases (panels viewed via a shared dashboard where the bound DataType is owned by someone else, and panels bound to a DataType with `owner_id IS NULL` such as the six pre-V15 legacy rows in the dev DB) — but neither matches the P0 surface as filed. Both are surfaced as spinoff candidates in `design.md`.

## 4. Fix design (full detail in `design.md`)

**Surface estimate:** ~40 LOC frontend implementation, ~30 LOC test, zero backend, zero schema, zero migration.

**Files to touch in cycle 2:**

- `frontend/src/features/panels/state/panelActions.ts` — add 1 new `createAction<string>` (~3 lines)
- `frontend/src/features/panels/state/panelsSlice.ts` — add 1 `extraReducers` case that walks `state.items`, narrows via `isBoundCapablePanel`, deletes matching `paginationState` entries (~10 lines)
- `frontend/src/features/panels/hooks/usePanelData.ts` — one-line guard change to bypass the dedupe early-return when `paginationEntry == null` (~1 line change + 1 dep added to the deps array)
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — one dispatch call inside the existing `onTerminal` callback when `event.status === "succeeded"` and `currentPipeline?.outputDataTypeId` is present (~3 lines)

**Before/after behavior:**

- Before: panel on dashboard X does not refresh after upstream pipeline run completes; user must reload the browser.
- After: panel re-fetches rows automatically within one render tick of the SSE `succeeded` event arriving in the user's session (same browser tab AND any other dashboard tab in the same Redux store — the action mutates the shared store).

**Why this is the minimum fix:**

- No HTTP contract change.
- No backend change. The cross-user binding scrub is left untouched (the orchestrator-relay instructed not to widen scope, and the cycle-1 investigation confirms the scrub is not the cause of the P0 symptom).
- Uses the existing SSE hook, the existing narrowing helpers, the existing Redux infrastructure.

## 5. Regression test plan

- `frontend/src/features/panels/state/panelsSlice.test.ts` — reducer unit test: given a state with three panels (two bound to typeId-A, one to typeId-B), dispatching `markDataTypeRowsStale("typeId-A")` clears exactly the two matching `paginationState` entries and leaves the third untouched.
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — integration-shape test: render `usePanelData(panel)` with a pre-loaded `paginationState[panelId]`, assert rows visible and no fetch dispatched (dedupe path); `act(() => dispatch(markDataTypeRowsStale(panel.config.dataTypeId)))`; assert `paginationState[panel.id]` cleared and the hook dispatches a fresh `fetchPanelPage` on the next render that returns new rows.
- Negative case: dispatching `markDataTypeRowsStale("some-other-typeId")` does NOT clear the entry for this panel.

No backend regression test required — no backend code changes. The existing `PipelineRunService` row-write tests already cover `overwriteRows` semantics.

## 6. Risk

- **Stale `currentPipeline.outputDataTypeId`** at the moment `onTerminal` fires (race with user editing the binding). Worst case: dispatches the action for the wrong typeId, which is a no-op (no panel matches → reducer walks the list without mutating). Safe.
- **O(panels) reducer walk** per pipeline-run completion. With 50 panels per dashboard and one dispatch per run, trivially cheap.
- **Other writers to `data_type_rows`** would also need the dispatch attached. After a code-wide grep, the only writer is `DataTypeRowRepository.overwriteRows`, called only from `PipelineRunService.onRunSuccess`. Document this in the cycle-2 PR so future writers (e.g. snapshot import that repopulates rows) wire in the same dispatch.
- **Cross-tab / cross-user invalidation** is still broken. Two browser tabs on the same dashboard, or user-A runs a pipeline whose output is bound to user-B's panels via sharing — the other tab / other user does not refresh. This needs a server-side SSE/broadcast channel keyed by `dataTypeId`, not by `pipelineId` (the existing SSE is per-pipeline-detail-page). **Explicitly out of scope** for HEL-242; surfaced as a spinoff candidate in `design.md`.

## 7. Blocker / escalation

None. Cycle 2 can proceed on the design above.

## 8. Verification gates (cycle 1)

Cycle 1 produced only OpenSpec change-folder docs (this file + `proposal.md` + `design.md` + `tasks.md`). No production code touched. No tests added or modified. No schemas changed. Gates required by the orchestrator-relay:

- `sbt test` — N/A for cycle 1 (no backend code changed); will run before commit as a defensive baseline
- `npm test` — same; defensive baseline
- `npm run build` — same
- `npm run lint`, `npm run format:check`, `npm run check:openspec` — same

Gate run results will be appended below before the cycle-1 commit lands.
