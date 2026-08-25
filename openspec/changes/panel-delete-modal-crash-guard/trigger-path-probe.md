# HEL-651 — widened trigger-path probe (tasks.md 1.2 / ticket AC 4)

Records the crash / no-crash outcome for each of the four widened trigger paths named in
`ticket.md`'s AC and `tasks.md` 1.2, with evidence. Written in cycle 2 in response to the
final-gate skeptic's REFUTE (`skeptic-final-1.md`, change requests 1–4) — the durable artifact
that was missing after cycle 1.

## 1. Deleting the panel from a different surface while the modal is open

**Outcome: crashed pre-fix (same root cause as the literal ticket repro), fixed by this change.**

The guard in `DesktopPanelGrid.tsx` is derived purely from the `panels` prop — it does not care
which UI surface removed the panel, only that it's gone. This is exercised directly by
`DesktopPanelGrid.test.tsx`'s first test ("does not crash and unmounts the modal when its backing
panel is removed while open"): the panel disappears from `panels` between renders and the
assertion is `not.toThrow()` — RED (`TypeError: Cannot read properties of undefined (reading
'id')`) against pre-fix `DesktopPanelGrid.tsx`, GREEN after. No separate probe needed beyond the
literal-repro Playwright capture already covering the "own surface" case in cycle 1 — a different
surface exercises the identical code path (removal from `panels`).

## 2. The panel being deleted by another actor (second tab / MCP apply / proposal apply) while the modal is open

**Outcome: no crash. Covered generically (design.md accepted risk + Jest simulation), and probed
live in cycle 1.**

A literal two-tab script is unreachable by construction: `panelsSlice.items` is only replaced by
`fetchPanels.fulfilled` (`panelsSlice.ts:144`), dispatched from `PanelList.tsx` on dashboard
(re)selection — there is no live/websocket sync, so a second tab's deletion is invisible to the
first tab until its own next `fetchPanels` dispatch. `design.md`'s "Risk, accepted" note records
this explicitly (not silently assumed).

Two levels of evidence:
- **Jest** (`DesktopPanelGrid.test.tsx`, test 2, "simulates a cross-actor removal ... without
  crashing"): panel absent from `panels` on first render, `panelsStatus: "succeeded"` — asserts
  `not.toThrow()` and the modal unmounts. RED pre-fix / GREEN post-fix (same mechanism as test 1).
- **Live Playwright probe (cycle 1)**: created a throwaway panel, opened its detail modal, deleted
  it via a direct authenticated `DELETE /api/panels/:id` call from the same Playwright session
  (out-of-band, simulating another actor/tab — required the `X-Helio-Requested-With: 1` CSRF
  header the app's own `httpClient` sends), then forced a same-tab dashboard re-selection to
  re-dispatch `fetchPanels`. Result: `pageErrors: []`, `consoleErrors: []` (only pre-existing
  benign 401 noise unrelated to this flow) — no crash, modal closed cleanly.

## 3. The parent dashboard being deleted with the modal open

**Outcome: no crash. The client never reaches `panelsStatus === "succeeded"` with the panel
absent on this path — the whole `DesktopPanelGrid` subtree unmounts instead, so this guard does
not need to (and does not) fire. Confirmed live, not just by code reading.**

Two sub-cases probed:

- **Out-of-band (another actor/tab deletes the dashboard via a direct API call, this tab's modal
  stays open):** there is no live sync (same reasoning as path 2) — the client has no way to learn
  the dashboard is gone until it takes its own action. Live probe: created a throwaway
  dashboard+panel, opened the panel's detail modal, called `DELETE /api/dashboards/:id` directly
  (`204`), waited 2s. The UI kept rendering the now-server-deleted dashboard and its open modal
  unchanged (`pageErrors: []`, `consoleErrors: []`) — stale but not crashed, consistent with the
  no-live-sync finding for path 2.
- **Same-tab, own-actor (the actually-reachable version — the user deletes their own currently-
  selected dashboard from the sidebar's own delete-confirm flow while that dashboard's panel-detail
  modal is open):** traced via code first — `dashboardsSlice.ts`'s `deleteDashboard.fulfilled`
  immediately reassigns `state.selectedDashboardId` to the next most-recent dashboard (or none),
  and `PanelList.tsx` only renders `<PanelGrid>`/`<DesktopPanelGrid>` while `selectedDashboardId`
  is set, keyed by that id — so a dashboard delete is a true remount, not a `panels`-prop mutation
  the guard would need to observe. Confirmed live: opened the panel's detail modal, then used the
  sidebar's own `ActionsMenu → Delete → Confirm` flow (dispatched via `dispatchEvent`, since the
  full-screen modal overlay blocks a literal mouse click on the sidebar, the same overlay behavior
  noted for the literal ticket repro in cycle 1) on the dashboard whose modal was open. Result: the
  app navigated cleanly to the next dashboard with a "Dashboard deleted." toast, `pageErrors: []`,
  `consoleErrors: []` — no crash, no stale modal.

## 4. The panel's bound DataType or pipeline being deleted while the modal is open

**Outcome: not reachable through the app's supported deletion paths while a panel remains bound —
confirmed live, not assumed from the skeptic's migration-file reading alone. No crash, no fix
needed, out of scope by construction.**

- **Direct `DELETE /api/types/:id` while a panel is bound:** `DataTypeService.delete`
  (`backend/src/main/scala/com/helio/services/pipelines/DataTypeService.scala:128-141`) checks
  `dataTypeRepo.existsBoundToAnyOwnedPanel` and rejects with `409 Conflict` —
  `"Cannot delete DataType: one or more panels are bound to it"` — before any DB delete happens.
  Live probe: created a throwaway panel bound to an existing (already-orphaned, 0-field, unrelated
  to any other active fixture) `DataType`, opened its detail modal, called the delete API directly.
  Result: `409`, body `{"message":"Cannot delete DataType: one or more panels are bound to it"}`.
  The DataType is never removed while bound, so `detailPanel` never becomes `undefined` on this
  path — this guard is structurally inapplicable here, not merely untested.
- **Deleting the owning pipeline instead:** the skeptic's migration read established the FK
  direction precisely — V22 defines `pipelines.output_data_type_id REFERENCES data_types(id) ON
  DELETE CASCADE`, i.e. deleting the *DataType* cascades onward to delete the pipeline, not the
  reverse. Deleting the *pipeline* does not touch its output DataType at all. Live probe: found
  the exact pipeline that produces the bound throwaway DataType (`GET /api/pipelines`, matched by
  `outputDataTypeId`), deleted it directly (`DELETE /api/pipelines/:id` → `204`), then re-fetched
  the DataType (`GET /api/types/:id` → `200`, still present). The panel's modal was left open and
  mounted throughout (no `retry` affordance appeared, panel content still read "No data
  available" — its ordinary "0-field, no rows" state, unchanged): `pageErrors: []`,
  `consoleErrors: []`.

Given both deletion directions are blocked/inapplicable while a panel is bound, this ticket's
guard (which only reacts to the panel itself disappearing from `panels`) correctly has no
coverage obligation here — there is no code path by which `detailPanel` becomes `undefined` via a
DataType/pipeline deletion while the panel row survives. No spinoff filed: there is no bug to
track, only a structural non-reachability confirmed by direct probing of both API routes.
