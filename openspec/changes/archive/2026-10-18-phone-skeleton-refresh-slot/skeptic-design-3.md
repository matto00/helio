## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed against the live tree at HEAD 49021293b96c55fc9d80a6ed79b5b55d925fb6b7. The change directory is untracked;
there is no code diff yet.

### What I verified (with evidence)

- **Round-1 and round-2 change requests are resolved in the artifacts.**
  - D3 now defines a positive `panelsSettledFor`, extracted from `App.tsx:105-110` `currentDashboardPanelsReady`. I
    confirmed the expression at those lines: `panelsMatchDashboard || (items.length === 0 && loadedDashboardId === id
    && status === "succeeded")`.
  - D2 gates the refresh effect on the settled predicate. That closes round 2's pre-dispatch-frame `false` overwrite.
  - The unbound-output server scenario is gone, and D1 cites the CHECK constraint. I confirmed it at
    `V94__outputs_model.sql:844-846`, and no later migration drops it.
  - The switch scenarios are in the spec and in task 3.1.
- **Every `withKnownFlag` site is listed, and the list is complete.**
  - `dashboardsSlice.ts` replace sites: `upsertDashboardById` at :79-86, used by `dashboardUpserted` (:415), create
    (:488), duplicate (:514), import (:521) and applyProposal (:525).
  - The map-replace sites: appearance (:455), layout including `keepLocalLayout` (:460-475), repair (:477-485) and
    rename (:491).
  - Only `fetchDashboards.fulfilled` (:434) assigns the list wholesale.
  - `layoutPlaced` (around :388-403) mutates the layout fields in place, so it keeps the flag already.
- **The flag is present when the skeleton starts.**
  - `DashboardRoute.tsx:32` selects a dashboard only when it is already `known` in `items`.
  - `hydrateTabs.ts:180` selects after the plan, which is built from the list.
  - So on a cold open the flag is in the store before `showDashboardPanels` (`App.tsx:177-183`) dispatches. The
    skeleton cannot start without it, and a mid-skeleton slot pop does not occur.
- **The backend premises hold.**
  - `DashboardRoutes.scala:40-41` maps `findAll` with `DashboardResponse.fromDomain`.
  - `DashboardRepository.findAll` (:57-68) is owner-only, inside `withUserContext`.
  - The `panels_select` RLS policy (V36) is `helio_can_access_dashboard(dashboard_id)`. The owner therefore sees panels
    that editors created, so the batched query will not undercount under prod RLS.
  - `DashboardResponse` is `jsonFormat8` (`DashboardProtocol.scala:241`), so an appended `Option` is safe.
  - The client predicate (`dashboardMeta.ts:35-40`: `type === "output" && outputId !== ""`) matches D1's SQL, given the
    CHECK constraint.
- **The schema and the referenced files exist.**
  - `schemas/dashboards/dashboard.schema.json` has `additionalProperties: false` (:42), so the field must be declared.
    Task 1.3 does this.
  - `e2e/hel1583-refresh-line-no-shift.spec.ts` exists.
- **I traced the in-session panel-mutation paths through `panelsSettledFor`.**
  - `createPanel`, `swapPanelOutput` and `duplicatePanel` (`panelThunks.ts:114/150/183`) mark the dashboard stale and
    then refetch. They reach a settled state, so the effect corrects the flag.
  - `deletePanel` (`panelThunks.ts:166`) marks it stale and does **not** refetch. See CR1.

### Verdict: REFUTE

### Change Requests

1. **D2/D3: deleting the last panel on a phone leaves an empty reserved slot above "No panels yet", and the design's
   claim that the effect covers in-session delete "by construction" is false for this case.**

   How it happens:
   - `deletePanel` (`panelThunks.ts:161-170`) dispatches `markDashboardPanelsStale(dashboardId)`. That reducer
     (`panelsSlice.ts:228-237`) sets `loadedDashboardId = null`, `status = "idle"` and `staleDashboardId = id`.
   - `deletePanel.fulfilled` (`panelsSlice.ts:283-284`) then filters the item out. No refetch follows.
   - When the deleted panel was the dashboard's only panel, the state comes to rest as `items: []`,
     `loadedDashboardId: null`, `status: "idle"`, `staleDashboardId: selected`.
   - `PanelList` renders that state as the terminal "No panels yet" empty state (`wouldShowZeroPanelEmptyState`,
     `PanelList.tsx` around :170-175).
   - `panelsSettledFor` is false for that state: `items` are empty, and `loadedDashboardId` is `null`, not the id.
   - So under D3, `DashboardRefreshLine` falls back to the stored flag. That flag is still `true`: the effect's last
     settled observation was the output panel itself, and D2 never dispatches in a non-settled frame.
   - Result: a 27px empty `aria-hidden` slot sits above the empty state on a dashboard with zero panels. It stays until
     a refetch.

   Why it matters:
   - The MODIFIED requirement says "A dashboard that is not pipeline-fed SHALL have no slot at any point."
   - Today's code renders no slot in this state: `loadedDashboardId !== selected` gives `NO_PANELS`, and so no slot.
   - The next switch back would reserve during the skeleton and then collapse the slot, which is a 27px jump.

   The PanelCard delete path is shared by the phone stack (`PanelCard.tsx:23`, `:171`). I found this by reading the
   code and did not reproduce it in a running app, because this is a design gate with no code to run. The state
   transitions are exact reads of the reducers cited above.

   Required revision:
   - In D3, and in D2's effect gate, treat the stale-terminal empty state as known-empty for the selected dashboard:
     `items.length === 0 && status === "idle" && staleDashboardId === id`. That is the same discriminator
     `PanelList`'s skeleton and zero-panel empty-state logic already uses (HEL-548 D1). In that state, panels are
     `[]`, the line does not reserve, and the effect may write `false`.
   - Do this without changing `App.tsx`'s `currentDashboardPanelsReady` behaviour. That gate deliberately treats this
     state as not ready so the picker refetches. The design must state whether this is a second exported predicate
     (for example `panelsKnownFor`) or a parameter. It must not silently widen the App helper, which task 2.2 promises
     is "behaviour unchanged".
   - Correct D2's "covers by construction ... in-session panel create/delete" wording accordingly.
   - Add a unit case to tasks 2.2b/2.3: delete the sole output panel (stale-mark, then fulfilled), and expect no slot
     and the flag written `false`. Add a matching spec scenario or task-3.1 assertion, for example "deleting the last
     panel leaves no slot".

### Non-blocking notes

- `fetchPanels.rejected` leaves `items: []`, `status: "failed"`, `loadedDashboardId: id`. That is not settled, so a
  pipeline-fed dashboard will reserve the slot above the load-error state, where today there is none. It is
  defensible, because nothing jumps on retry. The design should say it is intended, so the evaluator does not flag it
  as a regression.
- `jsonFormat8` becomes `jsonFormat9`. Check helio-mcp's dashboard types and any test that validates list items
  against `dashboard.schema.json`. Because `additionalProperties: false`, a client-side or MCP validator that is out of
  date will reject the new field.
- The D2 effect runs on desktop too, because `PanelList` is shared. This is harmless: one dispatch only when the value
  differs. Note it so the "desktop unchanged" claim stays precise: there is no layout change, but there is one extra
  Redux write.
