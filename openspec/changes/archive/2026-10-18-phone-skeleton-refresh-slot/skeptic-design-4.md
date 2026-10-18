## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed cold against the live tree at HEAD `49021293b96c55fc9d80a6ed79b5b55d925fb6b7`. The change dir is untracked,
so there is no code yet. I treated every claim in the artifacts as unverified and checked it against the source below.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/phone-skeleton-refresh-slot/HEL-1646`.
- **Round-3 CR1 (delete-last leaves a slot) is addressed:**
  - D3 now defines a second exported helper, `panelsKnownFor = panelsSettledFor || (items.length === 0 &&
    status === "idle" && staleDashboardId === id)`. It gates both the D2 effect and the line. `App.tsx` keeps
    `panelsSettledFor`, so its behaviour is unchanged by construction: a separate helper, not a parameter.
  - I traced the transitions against the reducers. `deletePanel` (`panelThunks.ts:159-170`) dispatches
    `markDashboardPanelsStale`. That reducer (`panelsSlice.ts:228-237`) sets `loadedDashboardId=null`, `status=idle`
    and `staleDashboardId=id`, and it only does so when the dashboard was the loaded one. `deletePanel.fulfilled`
    (`:283`) then filters the item out, with no refetch.
  - The resulting state, `items []`, `idle` and `stale === id`, is exactly the `wouldShowZeroPanelEmptyState`
    discriminator (`PanelList.tsx:171-175`). So the line sees `[]`, reserves nothing, and the effect writes `false`.
  - Deleting a non-last panel is also handled. `items` still match the dashboard through `panelsMatchDashboard`
    (`panelsSlice.ts:502-504`), so the state counts as known.
  - The spec has a matching "Deleting the last panel" scenario, and tasks 2.2 and 3.1 cover it.
- **The D3 frame analysis matches the code:**
  - `fetchPanels.pending` sets `loadedDashboardId` and clears `staleDashboardId`, but does not clear `items`.
  - `panelsRestored` (`panelsSlice.ts:157-167`) lands `succeeded` with the restored dashboard's items.
  - During a restore, `status` is `succeeded` with the previous dashboard's items (`PanelList.tsx:122-130`).
  - In every one of these "unknown" frames, both disjuncts of `panelsKnownFor` are false for the newly selected id.
    I checked a previous dashboard with zero panels too: there `loadedDashboardId` differs, and `stale` is either
    null or another id. So stale items are never read.
  - In-session create and duplicate (`panelThunks.ts:114-115`, `:183-184`) mark the dashboard stale and then refetch.
    Both are covered by the effect once the refetch settles.
- **The current line behaviour matches the Context section:** `DashboardRefreshLine.tsx` selects `items` whenever
  `loadedDashboardId === selectedDashboardId`, and reserves only on `feedingOutputIds(panels)`. It is mounted above
  `DashboardChipRow` in the phone branch (`PanelList.tsx:311-314`), so a slot pushes the skeleton down with no change
  to the skeleton itself. The reserved height is token-derived, `calc(var(--text-xs) * 1.6)` plus `var(--space-2)`
  (`DashboardMetaRow.css:92-98`), which matches DESIGN.md token use.
- **The cold-open ordering makes the flag available before the skeleton:**
  - `DashboardRoute.tsx:31-37` renders `PageStatus` until the list is known.
  - `hydrateTabs` runs only after `dashboards.status === "succeeded"` (`dashboardTabsListeners.ts:43-52`).
  - App's panels load waits on `tabsHydrated` (`App.tsx:173-183`).
  - So the list item, and its flag, is in the store before any panel skeleton for the routed dashboard. That is the
    premise D3's fallback depends on, and it holds.
- **The backend premises hold:**
  - The list route is `DashboardRoutes.scala:32-42`, which calls `DashboardService.findAll` and then
    `DashboardRepository.findAll`. That method is owner-scoped and runs under `ctx.withUserContext`.
  - Other `findAll` callers exist (`WorkspaceContextService.scala:125`). D1's "route-path-only method" keeps them free
    of the extra query.
  - `DashboardResponse` has 8 fields, so `jsonFormat8` becoming `jsonFormat9` is right
    (`DashboardProtocol.scala:35-49`, `:241`).
  - `V94__outputs_model.sql:844-846` has the CHECK `kind IS DISTINCT FROM 'output' OR output_id IS NOT NULL`, and no
    later migration drops it. `PanelRowMapper.scala:87,102` maps `""` to NULL and back. So
    `kind='output' AND output_id IS NOT NULL` mirrors `feedingOutputIds` (`dashboardMeta.ts:35-41`) exactly.
  - `output_id` has `ON DELETE CASCADE`, so deleting an Output removes the panel and the flag cannot go stale that way.
- **Contract:**
  - `dashboard.schema.json` is `additionalProperties: false` and `layoutVersion` is required. Adding an optional
    property is consistent with spray omitting `None`.
  - `check-schema-drift.mjs` compares schemas to the protocol case classes, so task 1.3's gate is real.
  - No helio-mcp validator references `dashboard.schema.json`. `helio-mcp/src/types.ts:52` has a typed `Dashboard`,
    which task 1.4 covers.
- **Client replace sites:** every `items[index] = dashboard` and map-replace site in `dashboardsSlice.ts` is named in
  D2. Those are `upsertDashboardById` (`:79-86`), rename (`:456`, `:492`), appearance, layout with `keepLocalLayout`
  (`:468-484`), and repair. The cited `dashboardUpserted` callers exist at the stated lines.
- **Scope and acceptance criteria:**
  - AC1 (frame-sampled equal tops, slow fetch, both themes): D4 and task 3.1, at 375 and 430.
  - AC2 (markdown-only unchanged): spec scenarios plus e2e.
  - AC3 (schema and contract in the same change): tasks 1.2-1.4.
  - The driver constraints (screenshots path, desktop unchanged, HEL-1668/1665 files untouched) are in tasks C4 and
    3.3. I found no scope drift and no placeholders or TBDs.

### Verdict: CONFIRM

### Non-blocking notes

1. **The wording is inconsistent between "settled" and "known".** Task 2.3 says "settled -> panels; otherwise ->
   flag". The D3 tail also says `useDashboardMeta` receives "the settled panel set". D3 itself says the line uses
   `panelsKnownFor`. The two only differ in the stale-empty state, where `items` is `[]` anyway, so passing either set
   to `useDashboardMeta` behaves the same. The line's reservation decision, however, must use `panelsKnownFor`, or
   round-3's defect comes back. Task 2.2's unit case and task 3.1's delete-last e2e would catch it. The executor
   should read 2.3 as "known".
2. **There can be a one-frame flash on a deep link to a dashboard that is not the most recent.**
   `fetchDashboards.fulfilled` auto-selects the most-recent dashboard (`dashboardsSlice.ts:446-448`) before
   `DashboardRoute`'s effect selects the routed id. So one painted skeleton frame can carry the other dashboard's flag.
   This is pre-existing selection behaviour: that frame already shows the wrong dashboard's skeleton today. Do not
   chase it in this ticket. If the e2e samples every frame from navigation, start sampling once the routed dashboard is
   selected, and seed each test user's target as its most recent dashboard, as the HEL-1583 spec does.
3. **The spec's absolute "no slot at any point" sits beside an accepted risk.** The Risks section accepts a stale
   cross-device flag. For example, another device deletes the last output panel between the list fetch and the panels
   fetch, which gives a slot during the skeleton on a dashboard that is no longer pipeline-fed. The window is tiny and
   self-corrects through D2, but the evaluator should not treat it as a spec violation.
4. **"Desktop unchanged" means layout only.** The D2 effect lives in the shared `PanelList`, so desktop gets at most
   one extra Redux write per dashboard when the stored flag differs. That is fine, and worth one line in the PR body.
5. **The cold-boot e2e must defeat the warm cache.** Switch-back cases with a slowed panels fetch need the HEL-1575
   warm restore not to bypass the fetch. A restore takes the "unknown" (flag) branch for up to 500 ms, which is
   correct behaviour but is not the slowed-fetch path the scenario names.
