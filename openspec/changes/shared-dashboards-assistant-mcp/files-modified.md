# Files modified (HEL-1785)

## Backend, main
- `backend/src/main/scala/com/helio/services/dashboards/DashboardAccessMessages.scala` (new) — the named `ViewOnly` and `OwnerOnlyDelete` refusal texts (D3; one object, `com.helio.services.dashboards`).
- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardRepository.scala` — `findVisibleWithRole`: one owned-or-named-grant dashboard with role, in `withUserContext` (D1).
- `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala` — `findAllVisible`, `findVisibleWithRole`; `findById` doc updated; `update`/`exportSnapshot` viewer refusal -> `ViewOnly`; `deleteInternal` -> `OwnerOnlyDelete`. Unchanged on purpose: `:186` duplicate and `:255` layout repair (owner-only, outside the MCP write path and the patch-set resolvers).
- `backend/src/main/scala/com/helio/services/dashboards/DashboardContentsService.scala` — viewer refusal -> `ViewOnly`.
- `backend/src/main/scala/com/helio/services/panels/AutoLayoutService.scala` — viewer refusal -> `ViewOnly`.
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — the four viewer refusals (create, batch update, `authorizeEditor`, `authorizeEditorOnDashboard`) -> `ViewOnly`. `:122` form-submit owner refusal untouched.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` — dashboard update viewer refusal and dashboard delete owner refusal now named (`edit N:` prefix kept); `authorizeEditorOnDashboard` gained an `index` parameter. `authorizeEditorOrOwnerOnPipeline` (pipeline) untouched.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPanelResolvers.scala` — the three `authorizeEditorOnDashboard` call sites (update, delete, create) pass `index`.
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceContextService.scala` — `assemble` reads `findAllVisible`; `toDashboardEntry` takes the role (default `owner`).
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceSearchService.scala` — `find` and `getResource(Dashboard)` grant-aware; the dashboard summary description states the role. `getResource(DataType)` stays `findByIdOwned` (owner-only).
- `backend/src/main/scala/com/helio/api/protocols/workspace/WorkspaceContextProtocol.scala` — `WorkspaceContextDashboard.accessRole`, `jsonFormat4`.
- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala` — shared-dashboard role rule.
- `schemas/workspace/workspace-context.schema.json` — `DashboardEntry.accessRole` (required, enum).

## helio-mcp
- `helio-mcp/src/helioApi.ts` — `listDashboards` sends `include=shared`; `getDashboard` viewer branch via paged `/panels`; header comment updated (D7).
- `helio-mcp/src/types.ts` — `accessRole` comment corrected.
- `helio-mcp/src/context.ts` — dashboard entries carry `accessRole`.
- `helio-mcp/src/tools/read.ts` — `list_dashboards` / `get_dashboard` descriptions.
- `getDashboardSnapshot` callers (D7): `helio-mcp/src/contextControls.ts` (catches any failure and degrades to no controls) and `helio-mcp/src/tools/outputControlsHandlers.ts` (three control tools, all inside `guarded`: a viewer's 403 surfaces as a tool error). Neither changed.

## Tests and fixtures
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceSharedDashboardsSpec.scala` (new) — D1/D3/D5 items 1-5 on `helio_app_test`, route + schema seam, REST refusal messages, prompt rule.
- `backend/src/test/scala/com/helio/api/routes/dashboards/SharedDashboardOutputRoutesRlsSpec.scala` (new) — D5 item 6.
- `backend/src/test/scala/com/helio/api/routes/dashboards/SharedDashboardPanelsSeamSpec.scala` (new) + `shared-test-fixtures/dashboards/viewer-panels-response.json` (new) — `/panels` shape seam.
- `helio-mcp/src/tools/sharedDashboards.test.ts` (new).
- `backend/src/test/scala/com/helio/services/workspace/WorkspaceContextServiceApplyBudgetSpec.scala` — constructor gains `accessRole`.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — two deliberate updates of `"Forbidden"` assertions to the named texts (editor dashboard delete, viewer panel PATCH).

- `backend/src/test/scala/com/helio/services/dashboards/EditorGrantCoverageSpec.scala` — three viewer-refusal assertions updated to the `ViewOnly` text (export, batch update, replace contents); the Output-create assertion (:236) is unchanged.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetDashboardGrantSpec.scala` — five viewer assertions updated to `edit 0: You have view-only access to this dashboard`.
- `backend/src/test/scala/com/helio/services/assistant/AssistantPipelineReadsSpec.scala` — the dashboard entry's expected key set gains `accessRole`.

## Evidence (in `.concertino/scratch/HEL-1785/`)
- Red: `red-1-workspace-spec.txt` (10 of 13 red at assertions), `red-seam.txt`, `red-mcp.txt`. Green: `green-*.txt`, `testFull2.txt` (10008 passed, 0 failed), `rls-helio-app.txt` (labelled `helio_app_test` lines, D5 items 1-6).
- Mutations: m1 `m1.txt`, m2 `m2.txt`, m3 `m3.txt` (needs the repository read moved to the system context as well: RLS alone already hides a public-only dashboard from a non-owner), m4 `m4.txt`, m5 `m5.txt`, m6 `m6.txt`, m7 `m7.txt`, m8 `m8.txt`, m9 `m9.txt` (RLS-only routes `/:id`, `/rows`, `/history`, `/history/:point/rows`, `/distinct-values` go 200; `/insight` stays 404, recorded as expected), m10 `m10.txt` (`/insight` 200 with the pipeline check forced open). Each red at its own assertion.
- m11 (`m11-rest-message.txt`): `DashboardService.update`'s viewer refusal reverted to a bare `Forbidden()` -> the REST-message test is red at its message assertion. m12 (`m12-prompt-rule.txt`): the prompt's viewer rule reworded -> the prompt-rule test is red. Both reverted; `git status` shows no mutation residue.

## C15 grep (e2e/, helio-mcp/src, frontend/src, backend tests)
- `"Forbidden"` literals: only `ApiRoutesSpec` :3220/:3244 tied to the changed sites (updated). Others (`PipelineRunServiceSpec`, `PipelineRunEditorPersistenceSpec`, `Hel1503EditorRunGapsSpec`) are pipeline-run refusals, unchanged; the frontend hits are unrelated mock errors.
- `GET /api/workspace/context` / `WorkspaceContextDashboard`: `helio-mcp` goldens carry no dashboards `accessRole` (omitted when the server omits it), still green; no e2e or frontend consumer.
- helio-mcp `listDashboards` callers (`read.ts`, `context.ts`, `getDashboard`): all pass through the new `include=shared`; existing suites green.
- No migration (C18).
