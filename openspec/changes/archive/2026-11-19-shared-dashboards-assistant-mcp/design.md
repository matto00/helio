## Context

Facts verified in planning (the executor re-verifies each before relying on it; file:line at main 27b4a7402):

- `DashboardService.findAll` (owner-only, `DashboardRepository.findAll(ownerId)`) feeds `WorkspaceContextService.assemble`
  (`WorkspaceContextService.scala:126`) and `WorkspaceSearchService.find` (`WorkspaceSearchService.scala:88`).
  `DashboardRepository.findAllVisiblePaged(userId, page)` (HEL-1773) returns `(Dashboard, role)` over owned + named
  grants, excludes public-only, dedupes self-grants, runs in `withUserContext`; HEL-1773 proved it as `helio_app_test`.
- `WorkspaceSearchService.getResource(Dashboard)` uses `DashboardService.findById` -> `findByIdOwned` (owner-only).
  `getResource(DataType)` uses `outputRepo.findByIdOwned` (owner-only); that is the only assistant tool returning Output
  columns/sample rows. `dashboardPanels` resolves `outputPipelineId` via `OutputReadAccess.readablePipelineId`, an
  app-level sharing-aware pipeline check, so it is `None` for a dashboard-only grantee in dev and prod alike.
- `assemble` also feeds `GET /api/workspace/context` (`WorkspaceRoutes.scala`), `DashboardAuthoringService` and
  `RefinementGrounding`. `schemas/workspace/workspace-context.schema.json` `DashboardEntry` is
  `additionalProperties: false` with `id, name, panelCount`.
- Assistant tools: `find`, `get_resource`, `test_connection`, `propose_dashboard`/`propose_pipeline`/`propose_combined`
  (create new artifacts only; `DashboardProposal` has no target dashboard id), `propose_patch_set` (edits existing
  artifacts; captured only when `PatchSetPreviewService.preview` succeeds). Preview reuses
  `PatchSetApplyResolvers.resolveAll`, the same resolvers apply uses: dashboard update refuses `Viewer` with
  `ServiceError.Forbidden()` ("Forbidden"); dashboard delete is owner-only (`Forbidden()`); panel update/delete/create go
  through `authorizeEditorOnDashboard` (`Viewer` -> `Forbidden()`). So the server already refuses; the message is bare.
- Owner-only actions with no assistant/MCP patch op: share, duplicate, folder move (`UpdateDashboardRequest` has no
  folder field). The only owner-only action reachable by a patch set is dashboard delete.
- helio-mcp: `listDashboards` calls `GET /api/dashboards` without `include=shared` (`helioApi.ts:245`, `types.ts:62`
  comment); `getDashboard` composes the list record with `GET /api/dashboards/:id/export`, which refuses viewers (403,
  `DashboardService.exportSnapshot`); `context.ts:571` lists dashboards the same way. `GET /api/dashboards/:id/panels`
  (`PublicDashboardRoutes`, under `optionalAuthenticate`, which resolves PAT bearer tokens) admits a signed-in named
  grantee. Write tools hit server routes that already 403 a viewer; `guarded` turns `HelioApiError` into
  `isError: true` text with status and message.

## Goals / Non-Goals

Goals: ticket.md acceptance criteria. Non-goals: proposal.md "Non-goals". No migration.

## Decisions

### D1. One grant-aware dashboard read for the workspace services

Add `DashboardService.findAllVisible(user, page): Future[PagedResult[(Dashboard, String)]]` delegating to
`findAllVisiblePaged`, and `DashboardService.findVisibleWithRole(id, user): Future[Either[ServiceError, (Dashboard,
String)]]` (owner -> `owner`; else the caller's NAMED grant role from `resource_permissions`; public-only grant, share
token, or no access -> `NotFound`, identical message to today). Implement the single read in `DashboardRepository`
with the same owned/named-grant join as `findAllVisiblePaged`, filtered by id, in `withUserContext` (no privileged
read). `findAll`/`findById` stay for their other callers; the doc comment on `findById` saying it is owner-only for the
assistant is updated.

`assemble` and `find` use `findAllVisible`; `getResource(Dashboard)` uses `findVisibleWithRole`. Counts and budget
truncation use the union page's `total`.

### D2. Wire shape

- `WorkspaceContextDashboard` gains `accessRole: String` (always set). `schemas/workspace/workspace-context.schema.json`
  `DashboardEntry` adds required `accessRole` enum `owner|editor|viewer`. A backend spec validates a real
  `GET /api/workspace/context` response for a viewer grantee against the schema (seam).
- `find`'s `WorkspaceResourceSummary` keeps its four fields (its format is `jsonFormat4` and is shared); a dashboard
  summary's `description` becomes `dashboard, N panels` for owned and `dashboard, N panels, shared with you as viewer
  (read-only)` / `... as editor (no delete, share or duplicate)` for granted ones. `get_resource`'s dashboard detail
  carries `accessRole` via `WorkspaceContextDashboard`.
- helio-mcp `WorkspaceContext` dashboard entries gain `accessRole`; `types.ts` comment at :62 is corrected.

### D3. Proposals: prompt guides, server refuses with a named reason

- `AssistantSystemPrompt` gains one short rule: every dashboard carries `accessRole`; on `viewer` never call
  `propose_patch_set` targeting it or its panels, explain it is view-only; on `editor` edits are fine but never propose
  deleting the dashboard; share, duplicate and folder moves are owner-only and unavailable to the assistant. A test
  pins the rule's presence (prompt text is not behaviour; the server check below is the authority).
- Server: introduce named messages in one place (`DashboardAccessMessages` or constants on an existing object, the
  executor picks and states which): `ViewOnly = "You have view-only access to this dashboard"` and
  `OwnerOnlyDelete = "Only the dashboard's owner can delete it"`. Use them at the viewer refusal of the patch-set
  dashboard update resolver and `authorizeEditorOnDashboard`, at the patch-set dashboard delete owner check, and at the
  direct REST refusals the MCP write tools reach: `DashboardService.update` (and any other `DashboardService`
  viewer refusal on the MCP write path: layout, contents, auto-layout), `DashboardService.deleteInternal`'s owner-only
  refusal (`OwnerOnlyDelete`), and `PanelService` viewer refusals for update, delete, create and batch.
  `authorizeEditorOnDashboard` gains an `index` parameter so its message keeps the `edit N:` prefix; its three call
  sites (`PatchSetPanelResolvers.scala:38,71,135`) are named in `files-modified.md`. Starting set found by the design gate (re-verify): `DashboardService.scala:217,269`,
  `DashboardContentsService.scala:148`, `AutoLayoutService.scala:164`, `PanelService.scala:148,225,282,320`, plus
  `DashboardService.scala:156` (`deleteInternal`, owner-only, fires for viewers too, so a viewer's `delete_dashboard`
  reads the owner-only text, which is accurate). `DashboardService.scala:176` (duplicate) and `:245` are owner-only
  refusals outside the MCP write path and stay unchanged; state so. The executor enumerates every
  `ResourceAccess.Viewer => Forbidden()` site reachable from
  an MCP write tool or the patch-set resolvers on a dashboard/panel, lists each in `files-modified.md`, and changes only
  the message (status stays 403). The patch-set resolver message keeps its `edit N:` prefix convention.
- No new pre-check in `AssistantToolExecutor`: `preview` is the server authority already, and a refusal returns `Left`
  so `capturedProposal` is never set. Tests assert both the tool result text and `proposal == None`.
- C15: grep `e2e/`, `helio-mcp/src`, `frontend/src` and backend tests for the literal `"Forbidden"` assertions tied to
  these sites and update or keep them deliberately; report hits.

### D4. helio-mcp

- `listDashboards` sends `include=shared` (always; the server param is opt-in). `list_dashboards`' description says
  items carry `accessRole` and viewer dashboards are read-only.
- `getDashboard`: list-find as today (now grant-aware); if the record's `accessRole` is `viewer`, read panels from
  `GET /api/dashboards/:id/panels` (`PagedResult[PanelResponse]`) instead of `/export`; owner/editor keep `/export`
  (unchanged shape). Mapping to the export's `SnapshotPanelEntry`: `snapshotId = id`, `id`, `title`, `type`,
  `appearance`, `config` copied; `dataAsOf`/`orphanedControlIds` dropped; no other field invented. The viewer branch
  therefore returns exactly what the signed-in app's panel list returns to the same grantee (the dashboard grant's own
  surface, which includes output-panel `config.controls` column names), not the narrower assistant detail. A seam test
  reads a real backend `/panels` response (captured from a backend spec into a shared fixture, or validated against
  the shared schema) so a shape change by sibling HEL-1780 turns it red. Result carries `accessRole`.
- The viewer branch requests `/panels` with `limit=500` and follows `total` with further pages until all panels are
  read, so it is not silently truncated (export has no cap).
- The list-find page is 200 and now covers the owned + shared union, so an owned dashboard can fall off page 1 sooner
  than before; accepted and noted in the tool description. `list_dashboards`' description tells clients to filter on
  `accessRole` before name-based writes (the `helio-news` find-by-name pattern).
- `context.ts` lists dashboards with `include=shared`; each dashboard entry carries `accessRole`; per-Output placement
  export reads that fail for a viewer-hosted dashboard degrade as they already do.
- Write tools: no client-side role check. A test drives `update_dashboard` (and `delete_panel`) for a viewer against a
  fake HTTP server returning the backend's real 403 body and asserts `isError` with `status 403` and the view-only text.
- No deploy, no dist rebuild (C8). PR says `deploy-mcp.sh` is the owner step for the hosted connector.

### D5. Proof as the NOBYPASSRLS role (C12, RLS AC)

A backend spec in the style of `DashboardSharedListRoutesSpec` (app pool `helio_app_test`, NOBYPASSRLS), labelled log
lines saved to `.concertino/scratch/HEL-1785/rls-helio-app.txt` and persisted:

1. `assemble` for viewer / editor / stranger / owner: dashboards and roles, `counts.dashboards`.
2. `find(user, <dashboard name>)` for the same users.
3. `getResource(Dashboard)` for viewer: panels with `outputPipelineId` all `None`; for stranger: NotFound; for a
   public-only dashboard: NotFound.
4. `getResource(DataType, <bound output>)` for viewer and editor: NotFound.
5. `propose_patch_set` via `AssistantToolExecutor` for viewer (panel rename) -> refused with the view-only message,
   `proposal == None`; editor rename -> accepted; editor dashboard delete -> refused with the owner-only message.

6. The path this change opens for MCP clients: helio-mcp `get_dashboard` hands a dashboard-only grantee the bound
   Output id. Fixtures on one shared dashboard: Output A (non-insight) whose latest history point has a stored payload,
   and Output B (`insight` kind) with an `ok` row in `output_insights`, each bound to a panel. For a dashboard-only
   VIEWER and EDITOR, on the `helio_app_test` app pool, call the real routes: on A `GET /api/outputs/:id`, `/rows`,
   `/history`, `/history/:point/rows`, `/distinct-values?column=<a column>`; on B `/insight`. Each MUST be the same
   `404` as an unknown id. Positive control: the same calls as the pipeline OWNER on the same pool return data (`200`,
   non-empty rows, the payload rows, non-empty distinct values, a non-null `render`). Label each line with role and pool.
   Reduction, stated with evidence: `/filter-capabilities`, `/assertion-status`, `/panels` and `/provenance` read the
   Output through the same `OutputRepository.findById` statement (`OutputService.scala:309,333,363,367`,
   `ProvenanceRoutes.scala:15-17`; the executor re-verifies these lines); they are covered by the statement-level proof
   plus `/rows`, not called individually. If the re-verification finds one that does not go through `findById`, call it.
   Gating: A's routes are gated by RLS `outputs_select` only; B's `/insight` is gated twice (RLS plus the app-level
   `accessChecker.requireAccess("pipeline", ...)` in `InsightAccess.resolve`).

If any of these services or routes is not constructible on the `helio_app_test` pool, say so and prove the underlying
statements (the exact SQL Slick generates) as that role instead, still with the owner positive control.

### D6. Tests (red first, C12)

Write each test before code and record the red run in scratch:

- `WorkspaceContextServiceSpec`/`WorkspaceSearchServiceSpec` (or a new `WorkspaceSharedDashboardsSpec`): D1 cases incl.
  public-only, stranger, self-grant listed once, role on each entry.
- Route + schema seam for `GET /api/workspace/context`.
- `AssistantToolExecutorSpec` cases for D3 with the fake transport only (C16); a patch-set resolver/preview spec for
  the named messages; `DashboardService`/`PanelService` route specs for the REST 403 message.
- helio-mcp vitest/jest: `listDashboards` query, `getDashboard` viewer branch and seam, context `accessRole`,
  write-tool refusal.
- Mutations after green, each red at its own assertion: (m1) `assemble` back to `findAll`; (m2) `getResource` back to
  `findByIdOwned`; (m3) public-only admitted; (m4) viewer refusal in `authorizeEditorOnDashboard` removed; (m5)
  dashboard-delete owner check removed; (m6) helio-mcp drops `include=shared`; (m7) `getDashboard` viewer branch uses
  `/export`; (m8) `dashboardPanels` uses an unchecked pipeline id lookup; (m9) D5 item 6's Output reads run on the
  BYPASSRLS pool (`withSystemContext` / superuser) instead of the app pool -> red at the RLS-only routes' `404`
  assertions (`/:id`, `/rows`, `/history`, `/history/:point/rows`, `/distinct-values`); `/insight` is expected to stay
  `404` under m9 (its app-level gate) and that is recorded, not counted as red; (m10) `InsightAccess`'s pipeline
  `requireAccess` forced to `Right(Viewer)` while on the BYPASSRLS pool -> `/insight` red (proves its app-level gate).

### D7. Executor notes from the design gate (round 3, non-blocking)

- Update the stale `helio-mcp/src/helioApi.ts:9-11` header comment alongside `types.ts:62`.
- `findAllVisiblePaged` orders `lastUpdated desc, id asc`; if `findAll` orders differently, update any ordering
  assertion in the workspace specs deliberately and say so.
- `getDashboardSnapshot` (`helioApi.ts:1246-1248`) reads `/export` alone and 403s for a viewer: enumerate its callers
  and confirm each either never sees a viewer dashboard or fails cleanly through `guarded`; list them in
  `files-modified.md`.

## Risks / Trade-offs

- `assemble` now reads more dashboards for grantees; the budget (`WorkspaceContextBudget`) bounds the response size.
- Changing the 403 message text could break a test asserting `"Forbidden"`; D3's grep handles it. Status codes do not
  change, so clients branching on status are unaffected.
- `/api/outputs/*` (`OutputRepository.findById`, `OutputHistoryService` history and payload rows) is gated only by
  RLS `outputs_select`. On BYPASSRLS dev/CI those routes DO serve a dashboard-only grantee; in prod they do not. This
  change makes the bound Output id easier to discover (MCP), not newly exposed (the app's panel list already returns
  it). Decision: accept RLS as the prod gate, as HEL-1773 did, with D5 item 6 as the proof; no app-level hardening in
  this change (it would touch the Output routes and their many callers). Named in the PR as a known dev/prod divergence.
- Sibling HEL-1780 owns `PublicDashboardRoutes` and frontend role reads; this change only calls `/panels` from MCP.
