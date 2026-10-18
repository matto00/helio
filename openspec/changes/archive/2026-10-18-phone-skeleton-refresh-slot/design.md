## Context

See proposal.md - Why. Current state, verified on 49021293b:

- `frontend/src/app/dashboardMeta/DashboardRefreshLine.tsx` renders the reserved empty slot
  (`<p class="dashboard-refresh-line" aria-hidden data-reserved>`) only when `feedingOutputIds(panels)` is non-empty,
  and reads `state.panels.items` whenever `loadedDashboardId === selectedDashboardId` - which `fetchPanels.pending`
  makes true at once, so during the skeleton it sees `[]` (cold open: no slot, placeholders sit ~27px higher; HEL-1583
  measured 128px vs 155px) or the previous dashboard's panels (switch). See D3.
- `DashboardRefreshLine` is already mounted above `DashboardChipRow` in the phone branch of `PanelList.tsx`, before
  the skeleton, so the skeleton itself needs no change: reserving the slot shifts the placeholders down.
- `GET /api/dashboards` (`DashboardRoutes` -> `DashboardService.findAll` -> `DashboardRepository.findAll`) returns a
  `PagedResult[DashboardResponse]`; `dashboard.schema.json` is `additionalProperties: false`.
- `panels.output_id` exists (used by `DashboardChangesRepository`'s `SELECT DISTINCT p.dashboard_id, p.output_id`).
- `dashboardsSlice` replaces whole items on `renameDashboard`/`updateDashboardAppearance`/`updateDashboardLayout`/
  `repairDashboardLayout` fulfilled; a response without the flag would silently drop it.

## Goals / Non-Goals

**Goals:** placeholder tops == real-card tops across the swap on pipeline-fed phone dashboards (375/430, light and
dark); markdown-only dashboards and desktop byte-for-byte unchanged in layout.

**Non-Goals:** skeleton geometry changes; a feeding-output count; changing `/api/dashboard-changes` or Home summary.

## Decisions

**D1 - New list field `hasPipelineFedPanels: boolean`, list endpoint only.** Computed in `DashboardRepository`
(or service) as one batched query over the page's dashboard ids, e.g. `SELECT DISTINCT dashboard_id FROM panels
WHERE dashboard_id = ANY(?) AND kind = 'output' AND output_id IS NOT NULL`, mirroring the client's
`feedingOutputIds` (`output_id` is a nullable FK; NULL decodes to `""` in `PanelRowMapper.scala:99-101`). An unbound
output panel cannot exist in the DB (`V94__outputs_model.sql:844-846` CHECK `kind IS DISTINCT FROM 'output' OR
output_id IS NOT NULL`), so the `IS NOT NULL` is defensive only and the unbound case is client-side only. The flag is
computed by a separate repository method called only from the `GET /api/dashboards` route path, so other
`DashboardService.findAll` callers (`WorkspaceSearchService`, `WorkspaceContextService`) pay nothing. It does NOT join `outputs`/check pipeline access: the client predicate
doesn't either, and the slot must match what the loaded panels will decide. `DashboardResponse` gains
`hasPipelineFedPanels: Option[Boolean] = None` (appended last, spray-json omits `None`), set only by the list route.
Schema: optional boolean property with a description naming HEL-1646 and the list-only emission. `jsonFormat8` ->
`jsonFormat9`; the executor checks `helio-mcp` dashboard types/validators and any test validating list items against
`dashboard.schema.json` (`additionalProperties: false`) and updates them in this change.
- *Alt: required on every DashboardResponse* - every create/PATCH/duplicate/import/apply path would need a panels
  query for a field only the phone skeleton reads; rejected as cost without benefit.
- *Alt: reuse `/api/dashboard-changes` `outputs[]`* - it is fetched for open tabs, not before the first panels fetch
  of a cold open, and it filters Outputs by pipeline access, which diverges from `feedingOutputIds`; rejected.
- *Alt: client-side memory (localStorage) of last-seen panels* - nothing on first visit/new device; rejected.

**D2 - Client keeps and refreshes the flag.** `Dashboard.hasPipelineFedPanels?: boolean`.
- *Keep:* ONE helper `withKnownFlag(prev, next)` (returns `next`, carrying `prev.hasPipelineFedPanels` when `next`
  omits it) is applied at EVERY site that replaces an existing dashboard item with a single-dashboard payload:
  `upsertDashboardById`'s replace branch (so `dashboardUpserted` callers - HEL-1457 409 resync
  `dashboardsSlice.ts:229-231`, `patchSetsSlice.ts:204`, `combinedProposalsSlice.ts:35`, `useFirstRunTemplate.ts:43`,
  `useFirstRunBuild.ts:88` - and create/duplicate/import/applyProposal all inherit it), and the map-replace reducers
  `renameDashboard`/`updateDashboardAppearance`/`updateDashboardLayout` (incl. `keepLocalLayout`)/
  `repairDashboardLayout`. Only `fetchDashboards.fulfilled` (the list) overwrites from the wire.
- *Refresh:* a `dashboardPipelineFedObserved({dashboardId, value})` action, dispatched by one effect in `PanelList`
  whenever `panelsKnownFor(selected)` is true (D3) and
  `feedingOutputIds(items).length > 0` differs from the stored flag. An effect over the settled panel set covers by
  construction every path that sets panels - `fetchPanels.fulfilled`, `panelsRestored` (HEL-1575 warm restore,
  which bypasses `fetchPanels.fulfilled`), `duplicateDashboard.fulfilled`, `importDashboard.fulfilled`
  (`panelsSlice.ts:335-349`) - AND in-session panel create and delete: deleting a non-last panel leaves matching items (settled); deleting the
last leaves `items: []` + `staleDashboardId === id`, which D3's `panelsKnownFor` treats as known-empty. No
  dashboards<->panels slice import cycle is introduced.
  - *Alt: extraReducers on each load action* - misses in-session create/delete and must be kept in sync with every
    future load path; rejected.

**D3 - One shared POSITIVE "panels settled for the selected dashboard" predicate.** `fetchPanels.pending` sets
`loadedDashboardId` to the fetched id and does not clear `items` (`panelsSlice.ts:238-241`), so today's selector in
`DashboardRefreshLine` (`loadedDashboardId === selectedDashboardId`) is true for the whole skeleton window and returns
`[]` (cold open) or the PREVIOUS dashboard's panels (switch). A negative "skeleton not showing" test is also wrong: in
the commit that changes `selectedDashboardId`, before `App.tsx`'s fetch effect runs, `status` is still `succeeded`
with the previous dashboard's items, so the skeleton predicate is false yet nothing about the target is known.
So: extract `App.tsx:105-110`'s `currentDashboardPanelsReady` expression into one exported pure helper
`panelsSettledFor(panelsState, dashboardId)` = `panelsMatchDashboard(items, id) || (items.length === 0 &&
loadedDashboardId === id && status === "succeeded")`, used by `App.tsx` (behaviour unchanged), the D2 effect gate, and
a SECOND exported helper `panelsKnownFor(panelsState, dashboardId)` = `panelsSettledFor(...) || (items.length === 0 &&
status === "idle" && staleDashboardId === id)`. The extra disjunct is the known-empty-after-invalidation state
(`deletePanel` -> `markDashboardPanelsStale` -> `deletePanel.fulfilled`, no refetch; the same condition `PanelList`'s
`wouldShowZeroPanelEmptyState` already uses). `panelsKnownFor` (not `panelsSettledFor`) gates the D2 effect and
`DashboardRefreshLine`; `App.tsx` keeps `panelsSettledFor`, behaviour unchanged. A second helper, not a parameter, so
App's call site cannot change by accident:
- known -> panels = `items` (or `[]` when settled-empty); reserve iff `feedingOutputIds(panels).length > 0` (today);
- anything else (loading, restoring, pre-dispatch frame, stale items of another dashboard) -> reserve iff the selected
  dashboard's `hasPipelineFedPanels === true`; never read stale items.
The D2 effect dispatches only when known, so it can never write `false` for a dashboard whose panels are unknown,
and deleting the last panel writes `false` (no slot above "No panels yet"). A failed panels fetch (`status: failed`)
is not known, so the slot follows the flag above the error state: intended, it keeps the cards still if a retry
succeeds and is an empty aria-hidden element.
`useDashboardMeta` receives the known panel set (or `[]` when not known). `PanelList`'s skeleton predicate is
untouched.
Text still renders only from `refreshFactOf(meta, now)`; `useDashboardMeta` receives the same settled panel set. The
reserved element is the exact same markup as today (`data-reserved="true"`), reusing `DashboardMetaRow.css`'s height.

**D4 - Proof.** New e2e `e2e/hel1646-skeleton-refresh-slot.spec.ts`, modelled on `hel1583-refresh-line-no-shift`:
seed a pipeline-fed dashboard, route-delay the panels fetch, sample per animation frame the first placeholder's top
and the first real card's top plus a `PerformanceObserver('layout-shift')` sum, at 375 and 430, light and dark;
assert equal tops (0.5px) and no shift attributable to the swap; plus a markdown-only case (no slot during skeleton,
none after), and two in-app switch cases with a slowed panels fetch: pipeline-fed -> markdown-only (no slot during
the target's skeleton) and markdown-only -> pipeline-fed (slot during the skeleton, tops equal across the swap).
Unit tests cover `panelsSettledFor` and the line with: loading `items: []`, stale items from another dashboard, the
pre-dispatch switch frame (`succeeded` + previous items), restore, settled-empty; and that the effect never writes
`false` in a non-settled frame. Must be shown red on 49021293b's frontend (27px) before green. Desktop guard: the existing desktop meta
row / grid specs pass unchanged. Screenshots of skeleton and loaded states in both themes at 375/430 go to
`/home/matt/Development/helio/.concertino/scratch/HEL-1646/`.

## Risks / Trade-offs

- [List flag stale vs loaded panels, e.g. another device added the first output panel] -> one-time shift at swap,
  identical to today's behavior; D2 corrects it on the client after the first load.
- [Shared dashboards arriving via a different listing path than `GET /api/dashboards`] -> flag absent, no
  reservation, today's behavior; acceptable (not a regression). Executor records which paths emit it.
- [List query cost] -> one indexed query per page (`panels.dashboard_id`), bounded by page size.
- [RLS] -> the query runs on the request's normal pool like the rest of `findAll`; never the privileged pool.

## Migration Plan

No DB migration. Additive optional wire field; older clients ignore it, a newer client against an older server
sees `undefined` and behaves as today. Rollback = revert.

## Planner Notes

- Self-approved: boolean over count; list-only emission (D1); placing the contract requirement in
  `mobile-dashboard-meta-line`.
- The MODIFIED spec also corrects HEL-1583 drift ("absent when unknown" vs the shipped reserved slot).
- Overnight rule: no UI decision here is new visual design; the slot reuses HEL-1583's owner-ruled reservation.
