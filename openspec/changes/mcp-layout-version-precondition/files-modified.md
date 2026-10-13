- `helio-mcp/src/types.ts` — `DashboardResponse.layoutVersion` (D1)
- `helio-mcp/src/httpClient.ts` — `HelioApiError.body` retained for non-2xx; new `HelioLayoutConflictError` (D4)
- `helio-mcp/src/helioApi.ts` — `updateDashboardLayout` (required version) and `autoLayoutDashboard` (optional) send `expectedLayoutVersion`; 409-with-dashboard mapped to `HelioLayoutConflictError`, never retried
- `helio-mcp/src/tools/layoutConflict.ts` — new: shared `layoutConflictResult` + `PlaceOutputsPackConflictError` (D6; wired from `write.ts` and `placements.ts` `guarded`, and thrown from `placementsHandlers.ts` where the pack conflict is caught)
- `helio-mcp/src/tools/layoutHandlers.ts` — passes the required version through
- `helio-mcp/src/tools/write.ts` — `update_dashboard_layout` required `expectedLayoutVersion`, `auto_layout_dashboard` optional; descriptions; conflict rendering in `guarded`
- `helio-mcp/src/tools/placements.ts`, `placementsHandlers.ts` — conflict rendering; pack conflict names created panel ids; success adds `layoutVersion`
- `helio-mcp/src/tools/refinement.ts` — patch-set tool descriptions document `expectedLayoutVersion` and the exact 200 + `failure` rollback outcome
- `helio-mcp/README.md` — "Layout version precondition (HEL-1524)" section
- `helio-mcp/src/helioApi.test.ts`, `helio-mcp/src/tools/layoutHandlers.test.ts`, `helio-mcp/src/tools/refinementSchemas.test.ts`, `helio-mcp/src/tools/combinedProposalHandlers.test.ts` — updated/added for the new argument, `layoutVersion` fixture, editSchema key survival
- `helio-mcp/src/tools/layoutPreconditionSeam.test.ts` — new: real MCP client/server + fake fetch; required-input rejection, body, 409 once, 409 verbatim, place_outputs pack 409
- `helio-mcp/scripts/layoutPreconditionSeam.ts` — new: live seam check (D7); transcripts `seam-check-transcript.txt` (green) and `seam-check-transcript-mutation-stripped.txt` (red) in this change dir
- `openspec/changes/mcp-layout-version-precondition/tasks.md` — ticked

## D5 classification: every post/patch/put/delete/postMultipart call in `helio-mcp/src/helioApi.ts` (48 call sites; the grep also matches one comment line)

| Function | Request | Classification |
| --- | --- | --- |
| analyzePipelineProposal | `POST /api/pipelines/analyze-proposal` | does not write dashboards.layout |
| createDataSource | `POST /api/data-sources` | does not write dashboards.layout |
| appendDatasetRows | `POST /api/data-sources/${dataSourceId}/rows` | does not write dashboards.layout |
| replaceDatasetRows | `PUT /api/data-sources/${dataSourceId}/rows` | does not write dashboards.layout |
| updateDatasetSchema | `PATCH /api/data-sources/${dataSourceId}/schema` | does not write dashboards.layout |
| updateDatasetRow | `PATCH /api/data-sources/${dataSourceId}/rows/${rowId}` | does not write dashboards.layout |
| deleteDatasetRow | `DELETE /api/data-sources/${dataSourceId}/rows/${rowId}` | does not write dashboards.layout |
| createCsvDataSource | `POST /api/data-sources` | does not write dashboards.layout |
| createCsvDataSource | `POSTMULTIPART /api/data-sources` | does not write dashboards.layout |
| createRestDataSource | `POST /api/sources` | does not write dashboards.layout |
| createSqlDataSource | `POST /api/sources` | does not write dashboards.layout |
| createPipeline | `POST /api/pipelines` | does not write dashboards.layout |
| addPipelineRoot | `POST /api/pipelines/${pipelineId}/roots` | does not write dashboards.layout |
| removePipelineRoot | `DELETE /api/pipelines/${pipelineId}/roots/${rootId}` | does not write dashboards.layout |
| addPipelineStep | `POST /api/pipelines/${pipelineId}/steps` | does not write dashboards.layout |
| expandPipelineShape | `POST /api/pipeline-shapes/${shapeId}/expand` | does not write dashboards.layout |
| runPipeline | `POST /api/pipelines/${pipelineId}/run` | does not write dashboards.layout |
| createDashboard | `POST /api/dashboards` | does not write dashboards.layout |
| replaceDashboardContents | `PUT /api/dashboards/${dashboardId}/contents` | replaces contents incl. layout, but server accepts no caller precondition on PUT contents |
| uploadImage | `POSTMULTIPART /api/uploads/image` | does not write dashboards.layout |
| updatePanelAppearance | `PATCH /api/panels/${panelId}` | does not write dashboards.layout |
| updatePanel | `PATCH /api/panels/${panelId}` | does not write dashboards.layout |
| placeOutputs | `POST /api/panels/batch` | no caller layout write; server appends panels (bumps version). Its follow-up pack = autoLayoutDashboard, no precondition (D5) |
| createContentPanel | `POST /api/panels` | does not write a caller-supplied layout; server appends/strips under the dashboard row lock (bumps version); no precondition accepted |
| applyProposal | `POST /api/dashboards/apply-proposal` | creates a NEW dashboard the call itself owns; no precondition applicable |
| proposePatchSet | `POST /api/refinements` | does not write dashboards.layout |
| applyPatchSet | `POST /api/patch-sets/apply` | CAN write layout via a dashboard update edit; patch already forwards expectedLayoutVersion (documented, D5); stale = 200 + failure + rollback |
| undoPatchSet | `POST /api/patch-sets/${applicationId}/undo` | server-recorded inverse; no caller precondition |
| applyPipelineProposal | `POST /api/pipelines/apply-proposal` | does not write dashboards.layout |
| applyCombinedProposal | `POST /api/proposals/apply` | creates a NEW dashboard the call itself owns; no precondition applicable |
| teardownResources | `POST /api/workspace/teardown` | deletes the dashboard; no layout write |
| updateDataSource | `PATCH /api/data-sources/${dataSourceId}` | does not write dashboards.layout |
| updatePipeline | `PATCH /api/pipelines/${pipelineId}` | does not write dashboards.layout |
| createOutput | `POST /api/pipelines/${pipelineId}/outputs` | does not write dashboards.layout |
| updateOutput | `PATCH /api/outputs/${outputId}` | does not write dashboards.layout |
| deleteOutput | `DELETE /api/outputs/${outputId}` | does not write dashboards.layout |
| previewOutputs | `POST /api/pipelines/${pipelineId}/preview` | does not write dashboards.layout |
| updateDashboard | `PATCH /api/dashboards/${dashboardId}` | name only (appearance/layout unexposed); no layout write |
| setPipelineSchedule | `PUT /api/pipelines/${pipelineId}/schedule` | does not write dashboards.layout |
| deletePipelineSchedule | `DELETE /api/pipelines/${pipelineId}/schedule` | does not write dashboards.layout |
| updatePipelineStep | `PATCH /api/pipeline-steps/${stepId}` | does not write dashboards.layout |
| deleteDashboard | `DELETE /api/dashboards/${dashboardId}` | deletes the dashboard; no layout write |
| deleteDataSource | `DELETE /api/data-sources/${dataSourceId}` | does not write dashboards.layout |
| deletePanel | `DELETE /api/panels/${panelId}` | does not write a caller-supplied layout; server appends/strips under the dashboard row lock (bumps version); no precondition accepted |
| deletePipeline | `DELETE /api/pipelines/${pipelineId}` | does not write dashboards.layout |
| deletePipelineStep | `DELETE /api/pipeline-steps/${stepId}` | does not write dashboards.layout |
| updateDashboardLayout | `PATCH /api/dashboards/${dashboardId}` | WRITES layout (breakpoints) - precondition REQUIRED (D2) |
| autoLayoutDashboard | `POST /api/dashboards/${dashboardId}/auto-layout` | WRITES layout (pack) - precondition OPTIONAL (D3) |
