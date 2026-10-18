## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 49021293b96c55fc9d80a6ed79b5b55d925fb6b7 (change dir untracked, artifacts only).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/phone-skeleton-refresh-slot/HEL-1646`.
- **Client predicate**: `frontend/src/features/panels/state/dashboardMeta.ts:35-41` `feedingOutputIds` = `type === "output"`
  and `config.outputId !== ""`. Backend: `panels.output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE`
  (`V94__outputs_model.sql:344`), and `PanelRowMapper.scala:99-101` decodes a NULL `output_id` to `""`. So
  "kind = 'output' AND output_id IS NOT NULL" on the server is equivalent to the client predicate (FK makes `''`
  impossible). D1's mirror claim holds; column is `kind`, not `type` (D1 already tells the executor to check).
- **List path**: `DashboardRoutes.scala:40-41` -> `DashboardService.findAll` (`DashboardService.scala:66-67`) ->
  `DashboardRepository.findAll` (`:57-68`, owner-only, `withUserContext`, paged). Confirmed. Shared dashboards never
  appear in this list, so the "different listing path" risk is moot for this endpoint.
- **Protocol/schema**: `DashboardResponse` is `jsonFormat8` (`DashboardProtocol.scala:241`), `tag: Option` precedent
  for omitted-None. `schemas/dashboards/dashboard.schema.json` has `additionalProperties: false` (line 42). Confirmed.
- **Spec delta**: MODIFIED header matches `openspec/specs/mobile-dashboard-meta-line/spec.md:8` exactly; all three
  existing scenarios are carried forward.
- **Warm restore**: `panelsRestored` (`panelsSlice.ts:157-167`, dispatched from
  `features/dashboards/tabs/warm/showDashboardPanels.ts:61`) does bypass `fetchPanels.fulfilled`. D2's hedge resolves
  to "yes, it bypasses"; task 2.2 covers it.
- **Reducer list** (`dashboardsSlice.ts`): see CR2 — incomplete.
- **"Not loaded" signal** (`panelsSlice.ts:238-257`, `PanelList.tsx:125-130`, `DashboardRefreshLine.tsx:24-29`):
  see CR1 — the design's premise is wrong.

### Verdict: REFUTE

### Change Requests

1. **D3 / Context: "panels not loaded" is undefined, and the design's stated premise is false.** `fetchPanels.pending`
   sets `state.loadedDashboardId = action.meta.arg` immediately (`panelsSlice.ts:241`) and does NOT clear `items`
   (documented at `panelsSlice.ts:492-500`). So throughout the skeleton window `loadedDashboardId === selectedDashboardId`
   already, and `DashboardRefreshLine`'s selector (`DashboardRefreshLine.tsx:25-29`) returns `state.panels.items`, not
   `NO_PANELS`: `[]` on a cold open, the PREVIOUS dashboard's panels on a dashboard switch. The design's Context bullet
   ("`panels` is `NO_PANELS` until ... so during `showPanelGridSkeleton` the line returns `null`") is the wrong
   mechanism. Consequence: if D3's "panels loaded for the selected dashboard -> today's rule" is implemented with the
   existing selector, the flag branch never runs during a cold open's `loading` window and the fix does nothing.
   Revise D3 to name the exact "panels belong to the selected dashboard" predicate, consistent with
   `showPanelGridSkeleton` (`PanelList.tsx:125-130`: `status === "loading"` / `restoringDashboardId === selected` /
   pre-dispatch `idle`, combined with `panelsMatchDashboard`), and handle a settled empty dashboard (`succeeded`,
   zero items) as loaded (no slot). Prefer reusing or extracting one shared predicate, not a second copy. Add a
   `DashboardRefreshLine.test.tsx` case for `status: "loading"` with `loadedDashboardId === selected` and `items: []`
   (flag true -> slot), and one with stale items from another dashboard.

2. **D2 / task 2.1: the replace-style reducer list is incomplete.** Other paths replace an existing dashboard with a
   single-dashboard response that will not carry the flag: `upsertDashboardById` (`dashboardsSlice.ts:79-86`, replace
   branch `items[index] = dashboard`) used by `dashboardUpserted` (`:415-417`). `dashboardUpserted` is dispatched by
   the HEL-1457 layout-conflict resync (`dashboardsSlice.ts:229-231`, `known` is the 409 `LayoutConflictResponse`
   body, a `DashboardResponse`), patch-set apply (`patchSetsSlice.ts:204`), combined proposals
   (`combinedProposalsSlice.ts:35`) and first-run (`useFirstRunTemplate.ts:43`, `useFirstRunBuild.ts:88`). Each would
   drop a known flag, violating the ADDED requirement "a client SHALL NOT drop a previously-known value". Revise D2 and
   task 2.1 so the preserve helper is applied inside `upsertDashboardById` as well as the four `.map` reducers, with a
   unit test through `dashboardUpserted` over an existing item.

3. **D2: refresh the flag on every path that sets panels for a dashboard, by name.** Besides `fetchPanels.fulfilled`
   (dashboard id = `action.meta.arg`) and `panelsRestored`, `duplicateDashboard.fulfilled` and
   `importDashboard.fulfilled` set `items` and `loadedDashboardId` directly (`panelsSlice.ts:335-349`) with panels in
   the payload. List all four in D2/task 2.2 so the executor does not stop at "any warm-restore path".

4. **D4 / task 3.1 and the spec: add dashboard-switch cases.** Because `items` hold the previous dashboard's panels
   during a switch (CR1), the switch path is where reservation can be wrong in both directions: pipeline-fed ->
   markdown-only must show no slot during the skeleton (today's code reserves one from the stale panels, which the new
   spec text "no slot at any point" forbids), and markdown-only -> pipeline-fed must show the slot. Add a spec scenario
   and an e2e case for a switch with a slowed panels fetch, in addition to the cold open.

### Non-blocking notes

- D1 SQL should read `kind = 'output' AND output_id IS NOT NULL` (the `<> ''` clause is harmless but cannot match given
  the FK). Use the page's ids from the already-fetched slice, in the same `withUserContext` block.
- `jsonFormat8` -> `jsonFormat9` with the field appended last; check for any test that builds `DashboardResponse`
  positionally or validates list items against the schema (helio-mcp types included).
- D2 import cycle: `panelsSlice` already imports `duplicateDashboard`/`importDashboard` from the dashboards side;
  check before adding `fetchPanels`/`panelsRestored` cases to `dashboardsSlice`.
