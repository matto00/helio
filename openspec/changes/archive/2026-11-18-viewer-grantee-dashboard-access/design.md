## Context

Stage 1 (commit 206a72d00) proved the claim with a red e2e whose grant preconditions were asserted. Owner rulings and the restated child-1 scope are in ticket.md. Facts the design rests on (verified in planning and by the child-1 design gate, skeptic-design-3.md; the executor re-verifies before relying on them):

- `GET /api/dashboards` -> `DashboardService.findAllWithPipelineFedFlag` -> `findAll(user.id, page)` -> `DashboardRepository.findAll(ownerId)` (owner filter). `findAllVisible` is unpaged and called only from `DashboardPanelAclSpec`. `DashboardService.findAll` is also used by `WorkspaceSearchService` and `WorkspaceContextService` (the assistant). helio-mcp (`helio-mcp/src/helioApi.ts:242`) lists dashboards through the same route.
- `pipelineFedDashboardIds` filters panels by ids and relies on RLS (`panels_select` = `helio_can_access_dashboard`, grant-aware), run in the caller's user context.
- `resource_permissions_select` RLS admits the dashboard owner and the named grantee; `dashboards_select` uses `helio_can_access_dashboard(id)`.
- Writes: `PATCH /api/dashboards/:id` and `/api/panels/*` admit editors (viewer 403); delete/duplicate/share/layout-repair are owner-only; form submit (`POST /api/panels/:id/submit`) is owner-only for every non-owner, editors included (`PanelService.scala:122`).
- Every per-panel read route in `PublicDashboardRoutes` admits a signed-in grantee via `authorizeResourceWithSharing` with no token.
- `/api/outputs/:id`, `/rows`, `/assertion-status`, `/filter-capabilities`, `/distinct-values` go through `OutputService.findById`/`OutputRowReads` -> `OutputRepository.findById` (`ctx.withUserContext(...)`), whose ONLY ACL is RLS: `outputs_select USING (helio_can_access_pipeline(pipeline_id))` (V94). `OutputReadAccess` is a hint helper, not this gate. So in prod (non-BYPASSRLS) a dashboard-only grantee — editor or viewer — gets 404 there, while in dev/CI/Playwright (BYPASSRLS superuser) the same request returns 200 with rows. Dev behaviour is therefore NOT evidence for routing; the `helio_app` transcript (D2) is. `/api/pipelines/:id`, `/run-events`, `/runs/latest` likewise require a pipeline owner/grant.
- The shell has no role gating; `DashboardResponse` carries `ownerId` but no role.

Finding vs. the driver's expected cut: editors are NOT "fully working" once listed. A dashboard-only editor is refused by `outputs_select`/pipeline routes in prod just like a viewer, so child 1 routes panel display reads by `accessRole !== "owner"`, not by viewer-ness.

## Goals / Non-Goals

**Goals:** ticket.md "Acceptance criteria — child 1".

**Non-Goals (drafted as later children in `.concertino/scratch/HEL-1773/children.md`):** per-panel routing of filter/sort controls, cross-filter, history/compare, insight, provenance, freshness/refresh line, run-refresh, data-invalid badge for non-owners; the Ask drawer for grantees; form submit for editors (product question: server is owner-only); read-only polish; whether the workspace assistant/search services and helio-mcp include shared dashboards (Home in the web app DOES list them, D7); change dots/warm cache for shared dashboards.

## Decisions

### D0. Opt-in listing keeps every existing caller unchanged

`GET /api/dashboards` gains an opt-in query parameter `include=shared`. Without it the route behaves exactly as today (owner-only, `accessRole: "owner"` on each item). The web app's list fetch passes it. This keeps helio-mcp, PAT callers, and the owner-only workspace assistant/search unchanged (whether they should include shared dashboards is child 5). An unknown `include` value is `400`.

Within the app, every owner-semantics consumer of the list uses OWNED dashboards only, via a `selectOwnedDashboards` selector: default landing (`getMostRecentDashboardId`), onboarding (`useOnboardingHost`, `OnboardingChecklist` counts), and any "you have no dashboards" empty state. A jest test per consumer seeds a list whose newest item is shared and asserts it is ignored.

### D1. Paged visible-list query; role computed in SQL; explicit dedupe

`DashboardRepository.findAllVisiblePaged(user, page): Future[PagedResult[(Dashboard, AccessRole)]]` replaces `findAllVisible` (delete the dead method; move its spec cases). Owned branch yields `owner`; granted branch is `perm.resourceType === "dashboard" && perm.granteeId === userId && dash.ownerId =!= userId` with the role from the grant row, so a self-grant can never produce a second tuple; public grants (null grantee) cannot match. Count and slice are taken over the same unioned query. Order `lastUpdated desc, id asc` for stable paging. Runs in `ctx.withUserContext(user.id)`. The spec seeds a real self-grant row for the "listed once" case, plus owned, viewer, editor, public-only, and a paging/count case across the union.

### D2. RLS proof, labelled by role

On the lane DB, using the SQL Slick actually generates (captured via `.result.statements` in a test or logged), each statement labelled with the role it ran as:

1. As non-BYPASSRLS `helio_app` with `app.current_user_id` = viewer, editor, stranger: the visible list query. Expected: viewer/editor see owned + granted; stranger sees none of the owner's.
2. As `helio_app` (viewer): `pipelineFedDashboardIds` for the shared id. Expected: the id.
3. As `helio_app` (dashboard-only viewer, then editor): `SELECT ... FROM outputs WHERE id = <bound output>`. Expected 0 rows — this is why D6 routes non-owners away from `/api/outputs/*`.
4. The per-panel rows path's mechanism: its GATE is `authorizeResourceWithSharing` (an app-level grant check), and its DATA reads (`panelRepo.findAllByDashboardId(accessAlreadyGranted = true)`, `outputRepo.findByIdInternal`, the snapshot read) run on the privileged `helio_privileged` (BYPASSRLS) pool via `withSystemContext`. Show: (a) the gate's grant lookup admits viewer and editor and refuses the stranger (run as the role the gate actually uses, labelled); (b) the Output and snapshot statements as `helio_privileged` return rows. Preferably also run the real `GET /api/dashboards/:id/panels/:p/rows` for viewer/editor/stranger against a backend whose app pool logs in as `helio_app` (200/200/404); if that is not practical locally, say so.

Save `.concertino/scratch/HEL-1773/rls-helio-app.txt`, persist it. (3) 0 rows and (4) rows are consistent: different routes, different pools.

### D3. Contract and fail-closed role

`DashboardResponse` gains `accessRole: Option[String]`; the list route always sets it (`owner` without `include=shared`). Other dashboard responses set it where known (create/duplicate/import -> `owner`; PATCH -> the caller's role). `schemas/dashboards/dashboard.schema.json` gets optional `accessRole` enum; helio-mcp's `DashboardResponse` type adds the optional field. A backend spec asserts the list route's JSON validates against the schema (seam), and a frontend test reads the same shape.

Client fail-closed rule: the effective role is `accessRole` when present; when absent, `owner` only if `ownerId === currentUserId`, else `viewer`. Every merge site routes through one preserve helper that keeps a stored `accessRole` when the incoming item lacks one: `upsertDashboardById`/`withKnownFlag`, `keepLocalLayout` (layout, repair), `dashboardUpserted` (patch-set apply), `applyProposal`. Reducer tests cover each.

### D4. Client role selectors

`features/dashboards/state` exports `selectDashboardAccessRole(id)` (D3 rule), `selectCanEditDashboard(id)` (owner|editor), `selectIsDashboardOwner(id)`, `selectOwnedDashboards`. Every gate uses these, never ad-hoc `ownerId` comparisons.

### D5. Gating

- Viewer (`!canEdit`): hide layout-edit toggle and its undo/redo/tidy tools, add panel (meta row, CommandBar, empty-state CTAs), refine with AI, appearance editor, panel title inline rename, panel action-menu mutating items (edit, duplicate, delete, bind); drag/resize disabled and no layout save ever dispatched.
- Non-owner (`!isOwner`, editors included): hide share, delete dashboard, duplicate dashboard, folder move; never send layout repair; hide form-panel submit (server is owner-only; a form panel shows its fields read-only with "Only the owner can submit", or no submit control); hide the "Ask about this dashboard" entry (meta row, kebab, CommandBar) — child 3 enables it.
- Panel detail modal (`PanelDetailModal`, opened by a card click via `onDetail` in `DesktopPanelGrid`/`MobilePanelStack`): for any non-owner, VIEW mode reuses the per-panel rows already loaded for the card (no `usePanelData` Output fetch, no `useOutputMeta`, no `getDistinctValues`, no viewer controls, no Output link, no `ProvenanceTrigger`). For an editor, EDIT mode keeps title and appearance editing; the binding section (`OutputPanelSection`, `OutputPicker`/`useOutputPickerData`, "Used on N dashboards" via `listOutputPanels`) is replaced by a read-only "Bound to <Output name from per-panel output-meta>" line with no fetch. Viewers never see edit mode.
- `TableRenderer.canWrite`: Output meta built from `/output-meta` carries `ownerId: null`, so column-persist `PATCH /api/outputs/:id` is unreachable for non-owners (jest case).
- The executor additionally greps the shell (`app/`, `features/dashboards`, `features/panels`, `features/layout`) for any affordance not named here and lists each with its gate in `files-modified.md`; anything ambiguous is hidden for viewers.

### D6. Read path for non-owned dashboards (named consumers)

For a dashboard whose effective role is not `owner`:

- Panel rows: read through the per-panel rows route. Preferred: reuse the existing per-panel data layer (`publicDashboardService.fetchPublicPanelRows` / `usePublicPanelData`, made token-optional) behind a non-owner branch, rather than a third rows path; the executor states which it chose and why. No sort/filter/cross-filter params sent. Output meta needed to render comes from `/output-meta` (token-optional `fetchPublicOutputMeta`).
- Not mounted (hidden, never errored) — each named with its file:
  - `useDashboardMeta` (`GET /api/outputs/:id`, `GET /api/pipelines/:id`) in `DashboardMetaRow` and `DashboardRefreshLine`: the freshness/refresh line is hidden for non-owners.
  - `usePanelRunRefresh` (`fetchOutputMeta`, `pipelineRunFanout` SSE `/api/pipelines/:id/run-events`, `runs/latest`): not started.
  - Data-invalid/assertion badge (`useDataInvalid` -> `/api/outputs/:id/assertion-status`): not mounted.
  - Filter/sort controls, filter capabilities, distinct values, cross-filter, table column-header server sort (client-side sort over the loaded page only, or disabled), history/compare sparkline, insight body (neutral "Not available on shared dashboards yet"), provenance trigger, "open Output"/Output editor sheet links, panel detail/fullscreen paths that fetch through Output routes (fullscreen reuses the already-loaded rows or is hidden).
  - `usePipelineOwnership` (`GET /api/pipelines/:id`): not mounted under the insight placeholder.
  - Warm tab cache and row reuse (`tabs/warm/warmCapture.ts`, `warmRestore.ts`, `panelRowsReuse.ts`): never capture/restore a non-owned dashboard through the Output path (skip them for non-owners).
- Invariant (C16, widened): while a non-owner opens and views the dashboard, opens a panel's detail view, and (editor) edits and saves a panel title, zero requests match `/api/outputs` (any suffix, including the list call) or `/api/pipelines`, no `/api/*` response is 4xx/5xx, and no console errors. The caller's own Output list (`GET /api/outputs?...`) may be issued only by an explicit editor "Add panel" action, which is outside the measured window and not exercised in this e2e.

### D7. Shared marker and list surfaces

Owner ruling 2 ("appear in their list") applies to every dashboard-list surface in the web app. Per surface:

- Sidebar/dashboards list, Home `DashboardShelf` (its items and its "All N" count), phone `DashboardChipRow`/dashboard sheet: shared dashboards appear WITH the "Shared" badge (DESIGN.md tokens, existing badge component if any, accessible name includes "Shared").
- `DashboardTabBar` (tabs the user opened) and command palette (`useResourceSearchActions`, `useRecentPaletteActions`): shared dashboards appear; the palette item's label carries a "Shared" suffix; the tab bar needs no marker.
- Home `changedDashboards` count: counts shared dashboards only if `GET /api/dashboard-changes` returns them (executor reports which; child 6 otherwise).
- Owned-only (D0): default landing and onboarding.
- Folder move actions hidden for non-owners.

A jest case per surface pins the decision.

### D8. Tests

- e2e `hel1773-viewer-grantee-dashboard.spec.ts` (full file): seed owner with a pipeline + Output panel and a text panel; viewer and editor are dashboard-only grantees. Viewer: opens; "Shared" marker in the sidebar and on the Home shelf; positive anchor first — Output panel rows visible and network settled — then the widened invariant (D6); no layout-edit/add-panel/rename/share/delete/ask controls; clicks the Output panel card and the detail view shows the rows under the invariant. Editor: opens; renames a panel, persists after reload; opens edit on the Output panel, changes its title and saves (persists) under the invariant, binding section shown read-only; no share/delete/form submit; same invariant. Owner: unchanged — edit controls present, no Shared marker, lands on their own dashboard after login even when a newer shared dashboard exists. Stranger: not found. One phone viewport for the viewer open.
- Red-first (honest): on 206a72d00 the extended file is red at the OPENS/LIST assertions only (the negative assertions cannot run there). Then, on the fixed code, one mutation per negative-assertion family, each red at its own assertion: (m1) list without `include=shared` from the app -> viewer opens red; (m2) layout-toggle viewer gate removed; (m3) add-panel viewer gate removed; (m4) panel-rename viewer gate removed; (m5) editor share/delete gate removed; (m6) Shared marker forced true -> owner no-marker check red; (m7) `useDashboardMeta` left ungated for non-owners -> invariant red on `/api/pipelines/` (or `/api/outputs/`) request; (m8) rows forced through `/api/outputs/` for non-owners -> invariant red; (m9) `PanelDetailModal` left ungated for non-owners -> invariant red on the detail/edit step. Transcripts saved.
- Backend: repository spec (D1 cases), route spec (`include=shared`, default unchanged, `400` on unknown value, `accessRole` on the wire, schema seam).
- Frontend jest: selectors incl. fail-closed rule, preserve helper at each merge site, owned-only landing/onboarding, each D7 surface, `TableRenderer.canWrite` false for non-owners, the non-owner rows branch, gating of meta row/card header/menus.
- Gates grep `e2e/` for every selector/accessible name the change alters and report hits (C15).

## Risks / Trade-offs

- Hiding Output-route features for non-owners is a deliberate temporary narrowing (child 2 restores them via per-panel routes); hidden, never broken.
- A user who is BOTH a dashboard grantee and a pipeline grantee loses filter/sort and freshness on the shared dashboard in child 1, although `/api/outputs/*` would serve them. Accepted for simplicity of the rule (role on the dashboard decides); child 2 restores the features through per-panel routes for everyone.
- The per-panel rows route enforces panel-controls-only filters; child 1 sends none, so no 400 path.
- No migration expected; if one becomes necessary it is V147 and the driver is told.
