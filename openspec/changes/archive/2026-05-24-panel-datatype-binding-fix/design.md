# Design — panel-datatype-binding-fix

## Cycle 1: investigation summary

### Path traced end-to-end

**Read path (panel rows):**

```
Dashboard mount
  → fetchPanels(dashboardId) thunk
    → GET /api/dashboards/:id/panels   (PublicDashboardRoutes.scala:29-46)
      → panelRepo.findByDashboardId
      → panelService.resolveBindingsForRead(panels, userOpt)
        → resolveSingleBinding for each panel
          → dataTypeRepo.findById(typeId, user.id)     ← owner-scoped check
            → if None: panel.withBindingCleared       ← cross-user scrub
            → if Some: panel preserved
    → Redux state.panels.items updated
  → PanelGrid renders each panel
    → PanelCardBody mounts → usePanelData(panel)
      → cache key = `${panelId}|${typeId}|${fieldMappingKey}`
      → if prevKey !== currentKey: dispatch fetchPanelPage
        → GET /api/types/:id/rows               (DataTypeRoutes.scala:33-39, NO user check)
          → dataTypeService.listRows(id)
            → dataTypeRepo.findById(id)        ← unscoped
            → dataTypeRowRepo.listRows(id.value)
        → state.panels.paginationState[panelId] = { rows, ... }
      → if prevKey === currentKey: no-op (already loaded)
```

**Write path (pipeline run):**

```
User clicks Run on PipelineDetailPage
  → POST /api/pipelines/:id/run         (PipelineRunSubmitRoutes)
    → pipelineRunService.submit
      → executeRun
        → engine.executeWithStepCounts
        → onRunSuccess:
            dataTypeRepo.update(...fields...)
            dataTypeRowRepo.overwriteRows(typeId.value, jsRows)  ← atomic DELETE+INSERT
            publish RunStatusEvent("succeeded")
  → SSE channel emits the event
  → PipelineDetailPage usePipelineRunEvents.onTerminal:
      setSseActive(false)
      dispatch(fetchPipelineRunHistory(id))      ← ONLY thing that fires
```

The pipeline-run completion does **NOT**:

- dispatch `markDashboardPanelsStale` (that only fires on panel create/delete/duplicate)
- dispatch any panels-slice cache invalidation
- notify any dashboard that one of its panels' rows just changed
- touch `paginationState`

The `usePanelData` cache deduplicator (`prevFetchKey === currentFetchKey`) guarantees the same cached rows survive re-renders unchanged. The only way it refetches is if the key changes (binding or fieldMapping edit, panel id change) — neither happens on a pipeline run.

### Hypothesis verdict: REFUTED for matt's normal flow

The carried hypothesis — `resolveSingleBinding` scrubs cross-user bindings, the scrub causes a clear-then-populate cache-key oscillation in `usePanelData` — is internally inconsistent with the actual code:

- The scrub mutates the response, not the DB. After a scrub, every subsequent GET also scrubs (deterministic), so the cache key would NOT oscillate; it would settle at `null` (and the hook's early-return path would render "no data" deterministically, not "sometimes").
- Empirical: matt is the owner of every DataType bound by every one of his panels in the live dev DB (verified by SQL JOIN). `resolveSingleBinding` returns the panel unchanged for matt; the wire response preserves `dataTypeId` (verified by `curl GET /api/dashboards/:id/panels` with matt's bearer token).

The scrub is reachable in two edge cases, but neither matches the bug surface as filed:

- Panels matt views via a shared dashboard whose bound DataTypes are owned by another user — but the **dashboards table sharing in the dev DB has no such configuration for matt**; the route would 404 before reaching the scrub.
- Panels bound to DataTypes whose `owner_id IS NULL` (six rows of legacy pre-V15 data in the dev DB) — the `r.ownerId === ownerUuid` predicate is unsatisfiable against a NULL column, so those panels' bindings would deterministically scrub for any user. This is a real (small) latent issue but not the P0 symptom; flag as spinoff.

### Root cause (verified)

**Pipeline-run completion does not invalidate the panels-slice pagination cache.** The dashboard view's rows are bound to whatever was fetched on first mount and never refresh unless:

- the panel binding is edited (cache key changes), or
- the dashboard is created / a sibling panel is created-deleted-duplicated (triggers `markDashboardPanelsStale → fetchPanels` next mount; but `fetchPanels` only re-fetches the panel list, not the rows — and `paginationState` survives the fetch), or
- the panel has a non-null `refreshInterval` (always null after backend round-trip per the wire-shape comment in `panel.ts:111-114`), or
- the user navigates to another dashboard and back (and `markDashboardPanelsStale` happens to have fired since).

The "sometimes" in the report maps cleanly to user behavior variance — refresh-the-page users see fresh data; same-session-multi-action users see stale data.

## Cycle 2 fix design

### Where the fix lives

Frontend-only. A small action + reducer case + one wire-up call in `PipelineDetailPage`. Backend (and ACL story) untouched.

### Mechanism

1. **New action** in `frontend/src/features/panels/state/panelActions.ts`:

   ```ts
   export const markDataTypeRowsStale = createAction<string>(
     "panels/markDataTypeRowsStale",
   );
   ```

2. **New reducer case** in `panelsSlice.ts` (in `extraReducers`, next to `markDashboardPanelsStale`): walk `state.items`, find every panel whose typed config (`MetricPanelConfig | ChartPanelConfig | TablePanelConfig`) has `dataTypeId === action.payload`, and `delete state.paginationState[panel.id]` for each. Use the existing `isBoundCapablePanel` narrowing helper (already exported from `panelNarrowing.ts`) so we don't duplicate the narrowing logic.

   When `usePanelData` re-renders with `paginationEntry === undefined` (because we just deleted it), its current behavior (`prevFetchKey.current === currentFetchKey` → early-return) would prevent the refetch. We must therefore also reset the dedupe-ref on the next render. The cleanest path is to make the reducer clear the entry AND have `usePanelData`'s effect bypass the prevKey guard when `paginationEntry == null && currentFetchKey != null`. That's a one-line addition: replace `if (prevFetchKey.current === currentFetchKey) return;` with `if (prevFetchKey.current === currentFetchKey && paginationEntry != null) return;`.

3. **Wire-up** in `PipelineDetailPage.tsx`:

   ```ts
   onTerminal: (event) => {
     setSseActive(false);
     if (id) void dispatch(fetchPipelineRunHistory(id));
     if (event.status === "succeeded" && currentPipeline?.outputDataTypeId) {
       dispatch(markDataTypeRowsStale(currentPipeline.outputDataTypeId));
     }
   };
   ```

   `currentPipeline.outputDataTypeId` is already in Redux (loaded by `fetchPipelineById`). Failed runs are excluded — `overwriteRows` is transactional, so a failed run did not modify persisted rows; refetching would just return identical bytes.

### Why this is the minimum fix

- It does not change any HTTP contract — no schema work, no backend, no Flyway, no protocol decoder.
- It does not touch the cross-user binding scrub (which would require ACL review and is out of scope per the ticket's "do not refactor `PanelService.resolveBindingsForRead`" rule).
- It does not introduce a new SSE channel or a polling loop or anything stateful at the backend.
- It uses existing primitives (Redux action, reducer case, the existing SSE hook) and existing narrowing helpers.

### Regression test plan

`frontend/src/features/panels/hooks/usePanelData.test.ts` — add a test case:

1. Render `usePanelData(panel)` with a bound MetricPanel and a store seeded with `paginationState[panel.id] = { rows: [{ a: 1 }], … }`.
2. Assert `result.current.rawRows.length === 1` and that no fetch occurred (the dedupe path).
3. `act(() => store.dispatch(markDataTypeRowsStale(panel.config.dataTypeId)))`.
4. Assert that `state.panels.paginationState[panel.id]` is now `undefined`.
5. Assert that the next render dispatches a `fetchPanelPage` action (mock the fetch to return new rows).
6. Assert `result.current.rawRows` is updated to the new rows.

A second test covers the negative path: dispatching `markDataTypeRowsStale("some-other-typeId")` does NOT clear the entry for this panel.

A third test (selector-level, in `panelsSlice.test.ts`) covers the reducer in isolation — given a state with three panels, two bound to typeId-A and one to typeId-B, dispatching `markDataTypeRowsStale("typeId-A")` clears exactly the two paginationState entries.

Backend regression coverage is unchanged — no backend code is being touched, and the existing `data_type_rows` + `overwriteRows` paths are already covered by `PipelineRunServiceSpec` / similar.

### Risks

- **Risk:** `currentPipeline.outputDataTypeId` is stale at the moment `onTerminal` fires (race between the user editing the output binding and the run completing). Mitigation: cycle-2 implementation reads the value at the moment `onTerminal` fires (already the case if we close over `currentPipeline`); worst case dispatches `markDataTypeRowsStale` for the wrong id, which is a no-op (no panel matches → reducer is a no-op walk). Safe.
- **Risk:** A reducer that walks `state.items` is O(panels) per dispatch. With 50 panels per dashboard and a single dispatch per pipeline-run completion, this is trivially cheap.
- **Risk:** Other code paths that mutate `data_type_rows` (snapshot import? bulk repopulate?) are not invalidated. After a quick scan, the only other writer is `DataTypeRowRepository.overwriteRows`, called only from `PipelineRunService.onRunSuccess`. If a new writer is added later, the same dispatch wire-up should attach to it. Document in the cycle-2 PR.
- **Risk:** Cross-tab invalidation is still broken — user with two browser tabs open on the same dashboard, runs pipeline in tab A, tab B's view stays stale. **Explicitly out of scope** (no SSE/broadcast channel for dashboard views); file as a spinoff.
- **Risk:** Cross-user invalidation — if user A runs a pipeline whose output is bound to user B's panels (via sharing), user B's session never learns. Also out of scope; same spinoff.

## Spinoffs surfaced by this investigation

1. **NULL-owner DataTypes scrub bindings for every user** — six rows of pre-V15 data in the dev DB have `owner_id IS NULL`, and `r.ownerId === ownerUuid` is unsatisfiable against NULL. Any panel bound to one of them shows "no data" for every viewer. Cleanup option A: a Flyway data-migration that assigns a default owner. Option B: tolerate `owner_id IS NULL` in `findById(id, ownerId)`. **Spinoff ticket.**

2. **Cross-tab / cross-user pipeline-run invalidation** — needs a server-side SSE/broadcast channel keyed by `dataTypeId` rather than `pipelineId` (the existing SSE is per-pipeline-detail-page). **Spinoff ticket** for an "agentic platform" story (the same channel would also satisfy "tell me when this DataType changes").

3. **`refreshInterval` is documented as frontend-only "until CS3 removes it"** — the `usePanelPolling` hook is therefore dead code in any real deployment because it always sees `null`. Either persist the field or delete the hook. **Spinoff ticket** for the panel-system v2 cleanup.

4. **`updatePanelBinding` does not ACL-check the target `dataTypeId`** — a user can PATCH their panel to bind to any DataType id regardless of ownership; the next GET silently scrubs the binding. Not a security issue (read-path scrub closes the loop) but confusing UX — a 400 at PATCH time would be cleaner. **Spinoff ticket** for the binding-UX hardening pass.
