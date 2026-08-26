# HEL-477 tasks.md 7.5 — exhaustive route-file audit-action enumeration

Every `post`/`put`/`patch`/`delete` directive under
`backend/src/main/scala/com/helio/api/routes/`, walked file-by-file (not discovered by a diff
grep), with either the audit action it maps to (via the service layer this ticket instrumented)
or an explicit out-of-scope reason. Read/GET-shaped mutations that don't actually change durable
state are called out as such.

## In the ticket's named scope (dashboards/panels/pipelines/data sources/data types/auth/tokens)

| Route file | Directive | Service call | Audit action |
| --- | --- | --- | --- |
| `dashboards/DashboardRoutes.scala` | `POST /api/dashboards` | `DashboardService.create` | `dashboard.create` (create-only branch, Decision 2) |
| `dashboards/DashboardRoutes.scala` | `POST /api/dashboards/:id/duplicate` | `DashboardService.duplicate` | `dashboard.duplicate` |
| `dashboards/DashboardRoutes.scala` | `PATCH /api/dashboards/:id` | `DashboardService.update` | `dashboard.update` |
| `dashboards/DashboardRoutes.scala` | `DELETE /api/dashboards/:id` | `DashboardService.delete` | `dashboard.delete` |
| `dashboards/DashboardRoutes.scala` (`AutoLayoutRoutes.scala`, mounted alongside) | `POST /api/dashboards/:id/auto-layout` | `AutoLayoutService.autoLayout` | `dashboard.update` (Decision 9 — layout is dashboard-owned) |
| `dashboards/DashboardContentsRoutes.scala` | `PUT /api/dashboards/:id/contents` | `DashboardContentsService.replaceContents` | `dashboard.contents.replace` |
| `dashboards/DashboardSnapshotRoutes.scala` | `POST /api/dashboards/import` | `DashboardService.importSnapshot` | `dashboard.import` (not `dashboard.create`, Decision 9) |
| `panels/PanelRoutes.scala` | `POST /api/panels` | `PanelService.create` | `panel.create` |
| `panels/PanelRoutes.scala` | `POST /api/panels/:id/duplicate` | `PanelService.duplicate` | `panel.duplicate` |
| `panels/PanelRoutes.scala` | `PATCH /api/panels/:id` | `PanelService.update` | `panel.update` |
| `panels/PanelRoutes.scala` | `DELETE /api/panels/:id` | `PanelService.delete` | `panel.delete` |
| `panels/PanelRoutes.scala` | `POST /api/panels/batch` | `PanelService.batchCreate` | `panel.batch_create` (one row/call, Decision 9) |
| `panels/PanelRoutes.scala` | `POST /api/panels/updateBatch` | `PanelService.batchUpdate` | `panel.batch_update` (one row/call, Decision 9) |
| `panels/BoundPanelRoutes.scala` | `POST /api/panels/bound` | `BoundPanelService.create` | `panel.create` (same action as the plain create path, Decision 9) |
| `pipelines/PipelineRoutes.scala` | `POST /api/pipelines` | `PipelineService.create` | `pipeline.create` |
| `pipelines/PipelineRoutes.scala` | `PATCH /api/pipelines/:id` | `PipelineService.updateName` | `pipeline.update` |
| `pipelines/PipelineRoutes.scala` | `DELETE /api/pipelines/:id` | `PipelineService.delete` | `pipeline.delete` |
| `pipelines/PipelineStepRoutes.scala` | `POST /api/pipelines/:id/steps` | `PipelineService.addStep` | `pipeline.step.create` |
| `pipelines/PipelineStepRoutes.scala` | `PUT /api/pipelines/:id/steps/order` | `PipelineService.reorderSteps` | `pipeline.step.reorder` (one row per call, `resourceId` = pipelineId, `metadata.stepIds` = resulting order — skeptic-final-1 round 1) |
| `pipelines/PipelineStepRoutes.scala` | `PATCH /api/pipeline-steps/:id` | `PipelineService.updateStep` | `pipeline.step.update` |
| `pipelines/PipelineStepRoutes.scala` | `DELETE /api/pipeline-steps/:id` | `PipelineService.deleteStep` | `pipeline.step.delete` |
| `pipelines/PipelineStepRoutes.scala` | `POST /api/pipeline-steps/:id/duplicate` | `PipelineService.duplicateStep` | `pipeline.step.duplicate` (mirrors `panel.duplicate`, `metadata.sourceStepId` = the original step — skeptic-final-1 round 1) |
| `pipelines/PipelineRunSubmitRoutes.scala` | `POST /api/pipelines/:id/run` | `PipelineRunService.submit` | `pipeline.run.submit` (submission only, Decision 5) |
| `pipelines/PipelineScheduleRoutes.scala` | `PUT /api/pipelines/:id/schedule` | `PipelineScheduleService.put` | `pipeline.schedule.upsert` |
| `pipelines/PipelineScheduleRoutes.scala` | `DELETE /api/pipelines/:id/schedule` | `PipelineScheduleService.delete` | `pipeline.schedule.delete` |
| `sources/DataSourceRoutes.scala` | `POST /api/data-sources` (all `create*` variants) | `DataSourceService.createStatic`/`createCsv`/`createTextUpload`/`createTextUrl`/`createPdfUpload`/`createPdfUrl`/`createImageUpload`/`createImageUrl` | `data_source.create` (uniform, Decision 8) |
| `sources/DataSourceRoutes.scala` | `PATCH /api/data-sources/:id` | `DataSourceService.update` | `data_source.update` |
| `sources/DataSourceRoutes.scala` | `DELETE /api/data-sources/:id` | `DataSourceService.delete` | `data_source.delete` |
| `sources/SourceRoutes.scala` | `POST /api/sources` (`createSql`/`createRest`) | `SourceService.createSql`/`createRest` | `data_source.create` (same resource type, Decision 8) |
| `sources/UploadRoutes.scala` | `POST /api/uploads/image` | `ImageUploadService.upload` | `image_upload.create` |
| `pipelines/DataTypeRoutes.scala` | `PATCH /api/types/:id` | `DataTypeService.update` | `data_type.update` |
| `pipelines/DataTypeRoutes.scala` | `DELETE /api/types/:id` | `DataTypeService.delete` | `data_type.delete` |
| `auth/AuthRoutes.scala` | `POST /api/auth/register` | `AuthService.register` | `auth.register` |
| `auth/AuthRoutes.scala` | `POST /api/auth/login` | `AuthService.login` | `auth.login` / `auth.login.challenged` / `auth.login.failed` (Decision 6) |
| `auth/AuthRoutes.scala` | `POST /api/auth/logout` | `AuthService.logout` | `auth.logout` |
| `auth/OAuthRoutes.scala` | `GET /api/auth/google/callback` (not a `post`/`put`/`patch`/`delete` directive, but the same completion path as login) | `AuthService.completeOAuth` | `auth.login` / `auth.login.challenged` (same split as password login, Decision 6) |
| `auth/MfaRoutes.scala` | `POST /api/auth/mfa/verify` | `MfaService.verifyLogin` | `auth.login` (success) / `auth.login.failed` (Decision 6) |
| `auth/MfaRoutes.scala` | `POST /api/auth/mfa/enroll` | `MfaService.startEnrollment` | **deliberately not audited** — no durable state changes until `confirm` (Decision 11) |
| `auth/MfaRoutes.scala` | `POST /api/auth/mfa/enroll/confirm` | `MfaService.confirmEnrollment` | `auth.mfa.enable` |
| `auth/MfaRoutes.scala` | `POST /api/auth/mfa/backup-codes/regenerate` | `MfaService.regenerateBackupCodes` | `auth.mfa.backup_codes.regenerate` |
| `auth/MfaRoutes.scala` | `POST /api/auth/mfa/disable` | `MfaService.disable` | `auth.mfa.disable` |
| `auth/ApiTokenRoutes.scala` | `POST /api/tokens` | `ApiTokenService.create` | `token.create` |
| `auth/ApiTokenRoutes.scala` | `DELETE /api/tokens/:id` | `ApiTokenService.revoke` | `token.revoke` |

## Composite/fan-out routes (design.md Decision 10 — N rows accepted, no top-level wrapper)

| Route file | Directive | Service call | Audit behavior |
| --- | --- | --- | --- |
| `proposals/DashboardProposalRoutes.scala` | `POST /api/dashboards/apply-proposal` | `DashboardProposalService.apply` | `dashboard.create` + one `panel.create`/`panel.update` per panel; a partway failure's rollback uses `deleteInternal` (no `dashboard.delete`) — verified by the new integration test |
| `pipelines/PipelineProposalRoutes.scala` | `POST /api/pipelines/apply-proposal` | `PipelineProposalService` (composes `SourceService`/`DataSourceService`/`PipelineService`/`PipelineRunService`) | one row per underlying instrumented call (`data_source.create`, `pipeline.create`, `pipeline.step.create`, `pipeline.run.submit`) |
| `proposals/CombinedProposalRoutes.scala` | `POST /api/proposals/apply` | `CombinedProposalService` (composes the two proposal services above) | union of both — no additional wrapper event |
| `patchsets/PatchSetRoutes.scala` | `POST /api/patch-sets/apply` | `PatchSetApplyService` → `PatchSetApplyForward` (dispatches per-edit to `panelService`/`dashboardService`/`dataSourceService`/`dataTypeService`/`pipelineService`) | one row per edit, via each edit's own already-instrumented method |
| `patchsets/PatchSetRoutes.scala` | `POST /api/patch-sets/preview` | `PatchSetPreviewService.preview` | **out of scope** — read-only projection, no writes at all |
| `patchsets/PatchSetUndoRoutes.scala` | `POST /api/patch-sets/:id/undo` | `PatchSetUndoService.undo` | one row per inverse edit, same fan-out pattern as apply |

## Out of scope — not named in the ticket's route/service list

The ticket's Description explicitly scopes mutation instrumentation to dashboards, panels,
pipelines (+ steps/runs), data sources, data types, and auth/token/MFA lifecycle
(`ticket.md` "Scope" + "Description"). Every route below mutates a resource TYPE the ticket does
not name, and is excluded on that basis — not overlooked:

| Route file | Directives | Reason |
| --- | --- | --- |
| `agents/AgentMemoryRoutes.scala` | `POST`/`DELETE /api/agent/memory`, `DELETE /api/agent/memory/:id` | agent free-form memory, not a ticket-named resource type |
| `agents/AgentPreferencesRoutes.scala` | `PUT /api/preferences`, `PUT /api/preferences/memory-enabled` | agent authoring preferences, not a ticket-named resource type |
| `alerts/AlertEventRoutes.scala` | `POST .../acknowledge`, `.../snooze`, `.../resolve` | alert-event state transitions, not a ticket-named resource type |
| `alerts/AlertRuleRoutes.scala` | `POST`/`PATCH`/`DELETE /api/alert-rules[/:id]` | alert rules, not a ticket-named resource type |
| `assistant/AssistantConversationRoutes.scala` | `POST`/`PATCH` on `/api/assistant-conversations[...]` | chat conversation records/messages, not a ticket-named resource type |
| `auth/BetaAccessRoutes.scala` | `POST /api/beta-access/request`, `.../redeem` | beta invite-code lifecycle, not a ticket-named resource type |
| `auth/PermissionRoutes.scala` | `POST /api/dashboards/:id/permissions`, `DELETE .../permissions/:userId` | sharing-grant CRUD, not a ticket-named resource type (dashboard/panel mutations themselves ARE covered; the grant row is not) |
| `auth/PipelinePermissionRoutes.scala` | `POST /api/pipelines/:id/permissions`, `DELETE .../permissions/:userId` | same as above, pipeline sharing grants |
| `metrics/MetricRoutes.scala` | `POST`/`PATCH`/`DELETE /api/metrics[/:id]` | metric definitions, not a ticket-named resource type |
| `patchsets/RefinementRoutes.scala` | `POST /api/refinements` | grounds + validates a `PatchSet`, never applies it — no persistence |
| `proposals/DashboardAuthoringRoutes.scala` | `POST /api/authoring/dashboard`, `.../requests/:id/outcome` | authors/validates a proposal (never applies) + accept/reject telemetry — no persistence of a ticket-named resource |
| `pipelines/PipelineShapeRoutes.scala` | `POST /api/pipeline-shapes/:id/expand` | pure expansion computation, no persistence despite the `POST` verb |
| `sources/DataSourcePreviewRoutes.scala` | `POST .../preview`, `POST /api/data-sources/infer` | read-only preview/inference, no persistence |
| `sources/SourcePreviewRoutes.scala` | `POST .../infer`, `.../test`, `.../preview` | read-only inference/connection-test/preview, no persistence |
| `hooks/HookRoutes.scala` | `POST /api/hooks/run` | dispatches to the already-instrumented `PipelineRunService.submit` (`pipeline.run.submit`) — listed here only because it's a distinct route file, not a distinct audit gap |

## Tracked gaps (real mutations, NOT instrumented by this ticket, NOT silently dropped)

Walking every route surfaced three mutations this ticket's explicit scope does not name but
which do change durable state. Recording them here — not fixing them in this change — per
CONTRIBUTING.md's "flag rather than silently reinterpret scope" convention; each is a reasonable
follow-up ticket, not evidence of a missed IN-scope call site:

1. **`sources/DataSourcePreviewRoutes.scala` `POST /api/data-sources/:id/refresh` →
   `DataSourceService.refresh`** — re-infers and rewrites the linked DataType's schema in place.
   Not named in the ticket's Description (which lists dashboards/panels/pipelines/data
   sources/data types' create/update/delete, not a source's own refresh sub-action). Arguably a
   `data_source.refresh` or `data_type.update` event.
2. **`sources/SourcePreviewRoutes.scala` `POST /api/sources/:id/refresh` →
   `SourceService.refresh`** — same shape, for SQL/REST sources.
3. **`workspace/WorkspaceRoutes.scala` `POST /api/workspace/teardown` →
   `WorkspaceTeardownService.teardown`** — bulk-deletes every tagged dashboard/panel/data
   source/data type/pipeline in one call, via `WorkspaceTeardownRepository` directly (its own
   scaladoc: not composable through the per-resource services `deleteInternal`/`delete` route
   through, since the whole teardown runs inside one `ctx.withUserContext` transaction). The
   single highest-blast-radius mutation in the entire route tree currently has zero audit trail.

Item 3 (workspace teardown) is the most significant of these — recommended as the first follow-up
ticket if the audit trail is meant to cover destructive bulk operations, which per the ticket's
own framing (a security audit trail) it plausibly should.

**Resolved (skeptic-final-1 round 1):** `PipelineService.reorderSteps`/`duplicateStep` were
originally listed here as tracked gaps; the final-gate skeptic correctly refuted that
classification — both are ordinary pipeline-step mutations well within "create/update/delete" +
step CRUD's spirit, not a genuinely new resource-type surface like items 1-3 above. Both are now
instrumented (`pipeline.step.reorder`/`pipeline.step.duplicate`) and moved into the in-scope table
above, with integration coverage in `AuditMutationInstrumentationSpec.scala`.
