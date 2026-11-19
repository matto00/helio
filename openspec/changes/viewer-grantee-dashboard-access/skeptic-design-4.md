## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 206a72d00f7d8712db1bb3524498634b5b2cd913 (the child-1 re-plan is uncommitted in the worktree). All findings come from the code. The artifacts were not taken as evidence.

### Prior round (skeptic-design-3.md): what was fixed

- **CR1 (mechanism).** Fixed. design.md Context now cites `OutputRepository.findById` -> `ctx.withUserContext`, with `outputs_select USING (helio_can_access_pipeline(pipeline_id))` as the only ACL. Checked against V94__outputs_model.sql:238-240 and OutputRepository.scala:144-145. The dev/BYPASSRLS caveat is stated. D2 adds the outputs-0-rows case. Sub-part (b) was carried over incorrectly; see CR1 below.
- **CR2 (named consumers).** Mostly fixed. D6 names `useDashboardMeta`, `usePanelRunRefresh`, the data-invalid badge, the warm cache, filter/sort/cross-filter, history, insight and provenance. D5 hides form submit and Ask for every non-owner. One consumer is still undecided: `PanelDetailModal`. See CR2 below.
- **CR3 (widened invariant).** Fixed. C16 and D6 now cover `/api/outputs/` plus `/api/pipelines/`, no 4xx/5xx, and no console errors, with a positive anchor and network settle first.
- **CR4 (list side effects).** Fixed for landing, onboarding, helio-mcp and the assistant/search, through D0's opt-in `include=shared`. This is consistent with "owners are unchanged": without the parameter the route is byte-for-byte the old list plus `accessRole: "owner"`. `selectOwnedDashboards` drives landing and onboarding, with a test for each. The Home shelf was missed; see CR3 below.
- **CR5 (red-first).** Fixed honestly. The unfixed run is red at the opens/list assertions only, and m1-m8 each target their own assertion family. I checked each against the code:
  - m7 fails by request count in dev, even though the request is 200 under BYPASSRLS, because the invariant counts requests.
  - m6 needs the owner check to assert no marker on the owner's own item, which D8 states.
- **CR6 (dedupe).** Fixed. D1 adds `dash.ownerId =!= userId` on the granted branch, takes count and slice over one query, and seeds a self-grant. V16's unique `(resource_type, resource_id, grantee_id)` means at most one grant row per grantee, so the granted branch cannot duplicate either.
- **Non-blocking notes.** All adopted: the Slick-generated SQL, the fail-closed role rule, the named merge sites, and reuse of the per-panel data layer. I checked the merge sites in the code: `withKnownFlag` (l.77), `upsertDashboardById` (l.92), `keepLocalLayout` (l.66, used at l.497/509), `dashboardUpserted` (l.438) and `applyProposal` (l.366).

### Independent checks (passed)

- **D0/D1.** The list chain is `DashboardRoutes.scala:40` -> `findAllWithPipelineFedFlag` -> `DashboardRepository.findAll` (owner filter, l.57-68). `findAllVisible` (l.169) is the dead union.
  - `pipelineFedDashboardIds` (l.74) runs in the user context over `panels`, and `panels_select` is grant-aware. D2 (2) covers it.
  - All three client list fetches (dashboardsSlice.ts:109, 242, 274) go through the one `dashboardService.fetchDashboards` (`/api/dashboards`, dashboardService.ts:20). Adding the parameter there covers the editor layout-conflict re-read too. Executor note: add it in the service function, not at one call site.
- **D3.** The fail-closed rule is defined: if `accessRole` is absent, the role is `owner` only when `ownerId === me`, else `viewer`.
- **D5 (existing gates).** `useStoredLayoutRepair` already reads `ownerId` (useStoredLayoutRepair.ts:37). `TableRenderer.canWrite` (l.51) pre-gates the column sort/filter/pin persistence `PATCH /api/outputs/:id` (tableRendererPersistence.ts) on Output `ownerId === me`. It stays closed as long as the per-panel meta path does not supply the dashboard owner's id as `ownerId`.
- **HEL-921 premise.** No child adds a payload route:
  - Child 2 keeps `/api/outputs/:id/history/:point/rows` unreachable and adds no per-panel payload route.
  - Child 3's ask keeps the per-call scope re-check, and `get_history_rows` is gated on a pipeline grant.
  - Child 1 reads only `/rows` (the latest snapshot, which the panel already displays) and `/output-meta`.
- **Stage-1 e2e.** It exists (`e2e/hel1773-viewer-grantee-dashboard.spec.ts`) at HEAD.

### Verdict: REFUTE

### Change Requests

1. **D2 (4) is wrong as written. As `helio_app`, the per-panel statements return 0 output rows, not "rows".**
   - The per-panel rows path never runs on the app pool:
     - `PublicPanelRowsResolver.scala:56` calls `panelRepo.findAllByDashboardId(..., accessAlreadyGranted = true)`, which runs under `ctx.withSystemContext` (PanelRepository.scala, about l.104).
     - Resolver l.62 calls `outputRepo.findByIdInternal(outputId)`, which is `ctx.withSystemContext(...)` (OutputRepository.scala:136-137).
     - `withSystemContext` is the privileged `helio_privileged` BYPASSRLS pool (DbContext.scala:53-63).
   - So D2 as written ("as the non-BYPASSRLS `helio_app` role ... (4) the per-panel rows resolution's statements ... (expected rows)") will produce a transcript that contradicts the design: `outputs` returns 0 rows under `outputs_select`. That transcript is the stated evidence for D6.
   - Required: restate D2 (4) so it proves the real mechanism. The route's gate is `authorizeResourceWithSharing` (a grant-aware app-level check). The data reads run as `helio_privileged`. Run (4)'s Output and snapshot statements as `helio_privileged` (or `SET ROLE helio_privileged`). Run the gate's grant lookup for viewer, editor and stranger, and show the stranger is refused. Better still, run the real `GET /api/dashboards/:id/panels/:p/rows` against a backend whose app pool logs in as `helio_app`.
   - Either way, label which statements ran under which role, so (3) 0 rows and (4) rows are both explained, not contradictory.

2. **`PanelDetailModal` reads through Output routes, and the plan does not say what a non-owner gets. The editor case contradicts the AC.**
   - A plain card click opens it in `view` mode (`initialMode` default "view", PanelDetailModal.tsx:37-47; mounted in DesktopPanelGrid.tsx:245 and MobilePanelStack.tsx:284 via `onDetail`).
   - `usePanelDetailData` calls:
     - `usePanelData`: rows via `/api/outputs/:id/rows` (usePanelDetailData.ts:5);
     - `useOutputMeta`: `GET /api/outputs/:id` (l.51);
     - `getDistinctValues`: `/api/outputs/:id/distinct-values` (l.41).
   - Edit mode mounts `OutputPanelSection` (PanelDetailModal.tsx:293). That calls `listOutputPanels` (`/api/outputs/:id/panels`, OutputPanelSection.tsx:23), `useOutputMeta`, `OutputPicker`/`useOutputPickerData` (`GET /api/outputs`), and `ProvenanceTrigger` (l.185).
   - D6 covers this only as "panel detail/fullscreen paths that fetch through Output routes (fullscreen reuses the already-loaded rows or is hidden)". That leaves two readings open:
     - (a) The card-click detail view is hidden for non-owners. Then the editor's "edit panels" (AC: "Editor: can open and edit (layout, rename, appearance, panels)") is lost, because D5 keeps "edit" for editors and it opens this same modal.
     - (b) It stays. Then every Output-panel click, and every editor edit, breaks the D6 invariant and 404s in prod.
   - Required:
     - Decide, in D5/D6, what view mode does for a non-owner. Suggested: reuse the already-loaded per-panel rows, no distinct-values/viewer controls, no Output link or provenance.
     - Decide what edit mode does for an editor on an Output panel. Suggested: title and appearance editable; the binding section (`OutputPanelSection`, picker, "Used on N dashboards") hidden or read-only with no fetch.
     - Extend D8: the viewer clicks the Output panel card (detail view) and the editor opens edit on the Output panel and saves a title change, both under the widened invariant.
     - Add mutation m9 (detail/edit modal left ungated for non-owners), red at the invariant.

3. **The Home shelf (and the other list surfaces) silently change, which contradicts Non-Goals and child 5.**
   - design.md Non-Goals and children.md child 5 both treat "Home" as owner-only in child 1 ("Child 1 keeps them owner-only, because `include=shared` is opt-in").
   - That is false in the web app. `HomePage.tsx:75` passes `dashboards.items` to `DashboardShelf`, which renders it, including the "All N" count (DashboardShelf.tsx:37-39). `HomePage.tsx:62` also counts `changedDashboards` from the same list.
   - Once the app fetch passes `include=shared`, shared dashboards appear on Home with no marker. D7 covers only "list/sidebar". `DashboardChipRow` (phone, l.82), `DashboardTabBar` (l.96) and the command palette (`useResourceSearchActions.ts:132`, `useRecentPaletteActions.ts:56`) inherit them too.
   - Required:
     - State per surface whether shared dashboards appear: Home shelf and its count, phone chip row, tab bar, palette.
     - Where they appear, state whether the "Shared" marker is shown (the AC says list/sidebar; the phone surface is the list equivalent on a phone).
     - Where Home is owned-only, use `selectOwnedDashboards`.
     - Correct child 5's premise in children.md to match. Add a jest case for each decided surface.

### Non-blocking notes

- `TableRenderer.canWrite` (l.51) compares the Output's `ownerId` to the current user. When the non-owner branch builds meta from `/output-meta`, make sure `ownerId` is the Output owner or null, never the viewer, so the column-persist `PATCH /api/outputs/:id` stays unreachable for grantees. A jest case would pin it.
- `usePipelineOwnership` (insight/usePipelineOwnership.ts:20) issues `GET /api/pipelines/:id` and tolerates 403/404. D6 hides insight bodies for non-owners. Confirm the hook is not mounted under the neutral placeholder, or the invariant goes red.
- The widened invariant matches `/api/outputs/` (with the trailing slash), which does not match the list call `GET /api/outputs?offset=...` (`useOutputPickerData`, `fetchOutputs`). Decide whether the list call is in scope. It is the caller's own Outputs, so it is harmless, but if it fires on dashboard open, say so explicitly.
- Children: child 2's "fullscreen/detail views that fetch" should also name the `PanelDetailModal` view mode once CR2 decides it.
