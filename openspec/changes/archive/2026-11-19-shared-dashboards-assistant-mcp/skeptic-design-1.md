## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 27b4a7402e0135322c2fcac1aeba16540ddce0a4 (= main). The change directory is untracked; the artifacts were read from disk.

### What I verified (with evidence)

The design's Context claims that I checked against the tree:

- **Owner-only workspace reads: confirmed.** `WorkspaceContextService.scala:126` calls `dashboardService.findAll`. `WorkspaceSearchService.find` uses the same `findAll`. `getResource(Dashboard)` goes through `DashboardService.findById` (`DashboardService.scala:90-94`) to `findByIdOwned`. `getResource(DataType)` uses `OutputRepository.findByIdOwned` (`OutputRepository.scala:217-222`), which has an explicit `ownerId` SQL filter, so dev and prod behave the same.
- **`findAllVisiblePaged` is grant-aware: confirmed.** `DashboardRepository.scala:172-196` admits named `editor`/`viewer` grants only. Public grants have no grantee and never match. It runs in `withUserContext`, and a self-grant resolves to `owner`.
- **`dashboardPanels` hides pipeline ids from dashboard-only grantees: confirmed.** It uses `OutputReadAccess.readablePipelineId`, which goes to `PipelineService.findSummaryById` and then `PipelineRepository.findByIdShared` (`:75-100`). That check is an explicit app-level owner-or-`pipeline`-grant check, so `outputPipelineId` is None for a dashboard-only grantee in dev and prod alike.
- **Panel count and panel list work for grantees in prod: confirmed.** Both use `PanelRepository.findAllByDashboardId` (`:57-107`), which applies an app-level owner/grantee/public predicate under `withSystemContext`, so prod RLS does not change the result.
- **Export refuses viewers: confirmed.** `DashboardService.exportSnapshot` (`:254-276`) returns `Viewer => Forbidden()`. Editors and owners get the snapshot.
- **`GET /api/dashboards/:id/panels` admits a PAT-authenticated named grantee: confirmed.**
  - The route is mounted under `authDirectives.optionalAuthenticate` (`ApiRoutes.scala:950-952`), which resolves PAT bearer tokens (`AuthDirectives.scala:63,99-108`). `confineScopedToken` only confines scoped tokens.
  - The gate is `authorizeResourceWithSharing` (`PublicDashboardRoutes.scala:211-233`).
  - The shape is `PagedResult[PanelResponse]` (`PublicPanelListResolver.panelList`): `id, dashboardId, title, type, appearance, config, dataAsOf, orphanedControlIds`, and no rows. `ownerId` is included only for the owner's view.
- **Assistant tool set: confirmed.** `AssistantToolExecutor.scala:104-110` has exactly `find, get_resource, test_connection, propose_dashboard, propose_pipeline, propose_combined, propose_patch_set`. `propose_patch_set` is captured only when `PatchSetPreviewService.preview` succeeds (`:327-336`), and `preview` passes `resolveAll`'s `Left` through unchanged (`PatchSetPreviewService.scala:48-51`). The patch-set resolvers are therefore the only path by which the assistant edits existing artifacts. Applying re-runs the same resolvers.
- **Resolver refusals: confirmed.**
  - Dashboard update returns `Viewer => Forbidden()` (`PatchSetApplyResolvers.scala:127`).
  - Dashboard delete is owner-only and returns `Forbidden()` (`:159`).
  - `authorizeEditorOnDashboard` (`:197-206`) is used by panel update, delete and create (`PatchSetPanelResolvers.scala:38,71,135`).
  - `ServiceError.Forbidden` defaults to `"Forbidden"` (`ServiceError.scala:24`).
- **Owner-only actions outside dashboard delete are unreachable: confirmed.**
  - `UpdateDashboardRequest` (`DashboardProtocol.scala:72-78`) has no folder, share or owner field.
  - helio-mcp has no duplicate, share, folder, repair or form-submit call (grep of `helioApi.ts`).
  - Through MCP, the only owner-only action an editor can reach is `DELETE /api/dashboards/:id`, which is owner-only 403 at `DashboardService.deleteInternal:156`.
- **helio-mcp line references: confirmed.** `listDashboards` is at `helioApi.ts:244-246` (no `include`). `getDashboard` composes the list with `/export` (`:249-263`). `context.ts:571` lists dashboards. The `types.ts:62` comment is stale as the design says. helio-mcp builds its own context client-side, and the frontend does not consume `/api/workspace/context` (grep).
- **Schema is closed: confirmed.** `WorkspaceContextDashboard` is `jsonFormat3` (`WorkspaceContextProtocol.scala:148,266`), reused by `DashboardDetail` (`WorkspaceResourceSearchProtocol.scala:65`). `WorkspaceContextServiceSpec:195,794` validates against the schema, so D2's schema update is enforced by an existing test.
- **Other `assemble` consumers are unaffected.** `RefinementGrounding` uses only `workspace.dataTypes` (owner-scoped), and no consumer branches on `counts.dashboards` (grep).
- **`/api/outputs/*` reads are gated by RLS only.** I checked this independently because the change now gives these ids to MCP clients:
  - `OutputRepository.findById` (`:144-145`) is a plain `withUserContext` select with no app-level predicate.
  - `OutputHistoryService.scala:50-53` (history) and `:59-64` (`payloadRows`) authorize "through `findById`".
  - HEL-1773's archived design records the same finding for `/rows`, `/assertion-status`, `/filter-capabilities` and `/distinct-values`: the only ACL is `outputs_select USING (helio_can_access_pipeline(...))`.
  - Result: in dev and CI (superuser, BYPASSRLS) a dashboard-only grantee **can** read these routes. In prod they cannot.

### Verdict: REFUTE

### Change Requests

1. **D5 does not prove the "no `/api/outputs/*` data, no payload rows" acceptance criterion on the path this change opens.** Of all the changed surfaces, only D4 hands a dashboard-only grantee the bound Output ids: helio-mcp `get_dashboard` returns `config.outputId`. An MCP client can then call `get_output_rows` (`/api/outputs/:id/rows`), `get_output`, `get_output_history`, `get_output_insight`, the history payload rows route (`/history/:point/rows`), or `filter-capabilities`. Every one of those is gated only by RLS (`OutputRepository.findById`, `OutputHistoryService.scala:53,64`), so dev/CI and prod diverge.

   D5 proves only the assistant's `getResource(DataType)`, which is a different gate with an explicit owner filter. Revise the design in three places:
   - **D5:** add proof items, run on the app pool (`helio_app_test`, NOBYPASSRLS) for a dashboard-only **viewer and editor**. Cover `GET /api/outputs/:id`, `/rows`, `/history`, `/history/:point/rows` (on an Output with a stored payload) and `/insight` for the shared dashboard's bound Output. Each must be the same 404 as an unknown id. If the routes cannot be built on that pool, prove the underlying statements as that role instead (D5's own fallback). Add a positive control: the same call as the owner returns data on the same pool.
   - **D6:** add a mutation that is red at this proof. For example, run the read with `withSystemContext` instead of the app pool.
   - **Risks:** state explicitly that on BYPASSRLS dev/CI these routes do serve a dashboard-only grantee, and say whether that divergence is accepted as-is (as HEL-1773 did) or hardened with an app-level check. If it is hardened, name the files and keep the change minimal.

2. **Internal contradiction: proposal.md versus D4 on what a shared dashboard exposes.**
   - proposal.md "What Changes", last bullet, says a shared dashboard exposes "panels' titles, kinds and bound Output ids **only**; no Output rows, **columns** or pipeline ids reach a dashboard-only grantee through **any of these surfaces**."
   - D4 has helio-mcp `get_dashboard` serve viewers through `GET /api/dashboards/:id/panels`. That returns the full `PanelResponse`: `config` (output-panel `controls` name Output columns), `appearance`, `dataAsOf` (the pipeline's `lastRunAt`) and `orphanedControlIds`.
   - The spec delta scopes "id, title, kind and bound Output id only" to the assistant's detail, which is right. The proposal does not.

   An evaluator will either fail D4 against the proposal or write a vacuous "no columns" MCP test. Fix it one of two ways:
   - narrow the proposal sentence to the assistant/search/context surfaces and say that MCP `get_dashboard` returns what the signed-in app's panel list returns to the same grantee (the dashboard grant's own surface); or
   - specify which fields D4 strips.

### Non-blocking notes

- **D4 mapping.** `SnapshotPanelEntry` requires `snapshotId` and `appearance`, and `PanelResponse` has no `snapshotId`. State the mapping before the executor guesses: for example `snapshotId = id`, or make `snapshotId` optional for the viewer branch.
- **REST delete message.** D3 renames the patch-set dashboard-delete refusal but not the REST one at `DashboardService.deleteInternal:156`. An editor's MCP `delete_dashboard` will still read a bare "Forbidden". Using `OwnerOnlyDelete` there too costs one line and keeps the surfaces consistent.
- **`authorizeEditorOnDashboard` signature.** It has no `index` today. Keeping the `edit N:` prefix means changing its signature at three call sites. That is fine, but it should be named in `files-modified.md`.
- **MCP list cap.** helio-mcp `getDashboard`'s list-find over the first 200 now covers the owned+shared union. An owned dashboard can fall off page 1 sooner than before. The design calls this "unchanged", but it is slightly worse; noting it is enough.
- **Name-based MCP automation.** Existing scripts that find a dashboard by name through `list_dashboards` and then `replace_dashboard_contents` (the `helio-news` pattern) will now also see shared dashboards. Items carry `accessRole`, so the tool description should tell clients to filter on it.
- **Sibling HEL-1780.** HEL-1780 owns `PublicPanelListResolver` and may change the `/panels` shape. D4's seam test is the guard; keep it reading a real backend response.
- **`ask_dashboard`.** It becomes discoverable for shared dashboards through MCP. Its admission of named grantees was ruled in HEL-1745, so this is not a new product question.

### Product questions for the owner

None. Change Request 1's "accept or harden the dev/CI divergence" is an engineering decision the design can make and state. HEL-1773 already accepted RLS as the prod gate.
