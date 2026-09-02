# Files modified — HEL-910

- `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala` — new `GET /dashboards/:dashboardId/panels/:panelId/rows` route (task 1.1), resolving `panelId -> outputId -> node_snapshot` via `panelRepo.findAllByDashboardId` + internal (RLS-bypassing) `outputRepo`/`nodeSnapshotRepo` lookups, gated by the existing dashboard-sharing ACL.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wires `nodeSnapshotRepoOpt` into `PublicDashboardRoutes`; wires `outputRepoOpt` into `DashboardService`'s new constructor param.
- `backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala` — task 2.1/2.2: new defaulted `outputRepo: OutputRepository = null` constructor param; `importSnapshot` now runs `validateImportPanels` (config decode + `Panel.validateConfig` + appearance validate + outputId existence check) before any repository write.
- `backend/src/main/scala/com/helio/services/dashboards/DashboardServiceValidation.scala` — updated in-code comment (was documenting the old "import skips cross-field validation" gap; now points at `DashboardService.validateImportPanels`, which closes it).
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala` — HTTP-level coverage for the new rows route (shared-dashboard success, non-shared 404, unresolvable-Output degrades to empty rows).
- `backend/src/test/scala/com/helio/infrastructure/persistence/PublicPathRlsSmokeSpec.scala` — new. RLS smoke test (non-superuser `helio_app_test` role) proving `outputs`/`node_snapshots` deny anonymous reads, with a red-before-trusted probe (drops `outputs_select`/`node_snapshots_select` on a disposable instance and shows the owner-positive assertion itself flips to failing).
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new test: import with a fabricated `outputId` returns 400 and creates nothing, using the real (non-null-wired) production `ApiRoutes` `outputRepoOpt`, so the assertion is not vacuous.
- `README.md` — "How data flows" diagram + feature bullets updated from Data source→Pipeline→Data type→Panel to Data source→Pipeline→Outputs→Dashboard; dropped "Metrics layer" bullet, added "Outputs" bullet.
- `CLAUDE.md` — key-endpoint list updated: added the new public rows route, replaced `/api/types`/`/api/types/:id`/`/api/types/:id/rows` with the real `/api/pipelines/:id/outputs` / `/api/outputs/:id` / `/api/outputs/:id/rows` / `/api/outputs` surface, noted `/api/types` and `/api/metrics` now 404.
- `openspec/config.yaml` — project-level `context` block: schema/domain-model/Redux-slice prose updated off `data_types`/`DataTypeId`/`dataTypesSlice` onto `outputs`/`node_snapshots`/`OutputId`/`outputsSlice`; Key Endpoints section updated to the real pipelines/outputs/panels/rows surface.
- `openspec/changes/public-dashboards-export-docs-sweep/tasks.md` — checklist progress (1.1–1.3, 2.1–2.3, 4.1–4.4 marked done).

## Not yet done (see final report for detail)

Task 3 (HEL-940 dataTypeId/DataTypeId/metricId/type_id rename across backend wire protocols +
services, frontend proposal/patch-set surfaces, helio-mcp, schemas, and 19 openspec/specs
capability-file deltas), task 5 (helio-news client rewrite; delivery-analytics-v2 script search
came back empty — see final report), task 6 (Playwright interaction-count E2E), and task 7
(final sweep + main-is-working confirmation) are not yet started.

## Cycle 4 (this executor) — tasks 6, 7

- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` — NEW. Task 6.1/6.2's E2E interaction-count proof: source (Manual/"paste-table") -> pipeline -> three Outputs -> all placed on a dashboard, real UI-driven, click-counting helper per design.md decision 8; and a second scenario placing an already-existing Output on a dashboard in exactly 2 interactions (the empty-state "Add panel" CTA opens the picker directly). The three-Outputs-to-dashboard scenario measures 28 real interactions, not the ticket's aspirational <= 12 — the file's own header comment proves by construction why 12 is unreachable against the shipped UI (every `OutputEditorSheet` create always re-opens on the hardcoded "chart" kind default, which requires 3 required selects; the cheapest kind, "table", still costs 4 clicks per Output, 12 alone for three Outputs, before a single click toward the pipeline or dashboard). See the final executor report for the full accounting.
- `.github/workflows/ci.yml` — task 6.3: wires the new spec into the existing `e2e` job (same pattern as HEL-813's guard); documents why the P1.4 Sleeper MCP rebuild (`helio-mcp/e2e/sleeper-rebuild.ts`) is not (yet) CI-wired — corrects the ticket brief's assumption (it needs live Sleeper credentials) with the real gap (it uses static representative data already; it just has no npm entry point and no PAT-bootstrap step in CI).
- `frontend/src/features/pipelines/types/pipelineStep.ts` — task 7.2 sweep fix: removed `PipelineAnalyzeResponse.outputDataTypeName`/`outputDataTypeId`, two genuinely dead required fields the backend's real `PipelineAnalyzeResponse` (`PipelineAnalyzeProtocol.scala`) has never carried and nothing in the frontend read. Distinct from `PipelineSummary.outputDataTypeId`, which stays (HEL-937-tracked, out of this ticket's scope).
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`, `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — drop the now-invalid `outputDataTypeName`/`outputDataTypeId` fixture fields on `PipelineAnalyzeResponse`-typed test objects (typecheck was red until this).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepository.scala` — task 7.2 sweep fix: doc comment claimed the legacy `binary_refs.data_type_id` column "stays in place" (present tense); V94 actually dropped it outright (`V94OutputsMigrationSpec` asserts `columnExists("binary_refs", "data_type_id") shouldBe false`). Corrected to past tense, no code change.
- `CLAUDE.md` — task 7.2 sweep fix: "Domain models use value-class ID wrappers (... `DataTypeId` ...)" was stale (`DataTypeId` doesn't exist in `model.scala` any more); corrected to `OutputId`.
- `openspec/changes/public-dashboards-export-docs-sweep/specs/backend-persistence/spec.md` — NEW spec delta, a genuine gap in the prior cycle's task 3.6 enumeration (that pass was scoped to `dataTypeId|DataTypeId|metricId`, not the full final-sweep pattern list including `type_id`/`computed_fields`). MODIFIED three requirements ("Hot filter columns are indexed", "JSON columns use JSONB storage type", "Typed MappedColumnType for JSONB-backed domain fields") to drop `data_types`/`type_id`/`computed_fields` references to a table and column that no longer exist, per HEL-903/904. Two now-unreachable scenario names are kept verbatim (with a note explaining why) because OpenSpec's archive tooling refuses to drop a previously-listed scenario name from a MODIFIED block.
- `openspec/changes/public-dashboards-export-docs-sweep/tasks.md` — marks tasks 1.4 (HEL-941 already filed, per workflow-state.md), 6.1-6.3, and 7.1-7.3 complete. tasks.md is now 100% checked off.

## Cycle 2 (this executor) — evaluation-1.md change requests 1 & 2

CR1 correction: the cycle-4 note above ("`PipelineSummary.outputDataTypeId` stays, HEL-937-tracked")
is now stale — the evaluator found the selector reading it had zero non-test consumers, so it and
the field are deleted here, not kept.

- `frontend/src/features/pipelines/types/pipelineStep.ts` — CR1: deleted `Pipeline.outputDataTypeId`
  and `PipelineSummary.outputDataTypeId` (and the false "still read by the legacy wizard" comment).
- `frontend/src/features/pipelines/state/pipelinesSlice.ts` — CR1: deleted the dead
  `selectPipelineNameByOutputTypeId` selector (zero non-test consumers) and its doc comment.
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` — CR1: dropped the
  `selectPipelineNameByOutputTypeId` import and its 3-test `describe` block.
- `frontend/src/features/panels/ui/PanelList.test.tsx`, `frontend/src/features/pipelines/ui/PipelinesPage.test.tsx`,
  `frontend/src/features/pipelines/ui/PipelineListTable.test.tsx`,
  `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`,
  `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.test.tsx`,
  `frontend/src/features/pipelines/ui/CreatePipelineModal.test.tsx`,
  `frontend/src/features/proposals/ui/CombinedProposalReviewPage.test.tsx`,
  `frontend/src/features/proposals/state/combinedProposalsSlice.test.ts`,
  `frontend/src/app/App.test.tsx`, `frontend/src/shared/chrome/SidebarBody.test.tsx` — CR1: dropped
  the now-invalid `outputDataTypeId`/`outputDataTypeName` fixture fields (some type-checked against
  `PipelineSummary`, so removal was required for `tsc`, not just cosmetic).
- `backend/src/main/scala/com/helio/api/protocols/proposals/DashboardProposalProtocol.scala` — CR2:
  deleted the `metricId` field/encode/decode from `ProposalPanel`; the "binds the panel to a defined
  metric (`metric`/`chart`/`table` panels only)" comment (those kinds don't exist) went with it.
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` —
  CR2: dropped the `metricId` entry from the `propose_dashboard`/`apply_proposal` tool JSON schema.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — CR2: removed the stale comment claiming a
  `metricRepo` argument is threaded into `DashboardProposalService` ("HEL-549: metricRepo threaded
  ... only touched when a proposal panel actually carries a metricId") — no such argument exists;
  the real argument is `outputRepoOpt.orNull`.
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — CR2: removed
  the stale "THEN (HEL-549) that a panel carrying a `metricId` resolves ..." clause from
  `preValidateBindings`'s doc comment.
- `schemas/dashboards/dashboard-proposal.schema.json` — CR2: removed the `metricId` property.
- `helio-mcp/src/types.ts` — CR2: removed `ProposalPanel.metricId` and its doc-block bullet.
- `helio-mcp/src/tools/proposal.ts` — CR2: dropped `metricId` from the comment enumerating legacy
  wire-stability-only fields (the tool's zod `panelSchema` never declared a `metricId` field, so no
  schema change was needed there).
- `backend/src/test/scala/com/helio/api/protocols/proposals/DashboardProposalProtocolSpec.scala` —
  CR2: dropped the `metricId` constructor param from the `panel(...)` test helper and the 5-test
  "ProposalPanel.write/read — metricId" `should` block.
- `backend/src/test/scala/com/helio/api/AuditMutationInstrumentationSpec.scala`,
  `backend/src/test/scala/com/helio/services/assistant/AssistantToolExecutorSpec.scala`,
  `backend/src/test/scala/com/helio/services/assistant/AssistantServiceSpec.scala`,
  `backend/src/test/scala/com/helio/services/proposals/CombinedProposalServiceValidateSpec.scala`,
  `backend/src/test/scala/com/helio/services/proposals/DashboardProposalServiceValidateSpec.scala` —
  CR2: dropped the now-nonexistent `metricId` argument from `ProposalPanel(...)` construction sites
  (one was positional, so the arg count had to be fixed too, not just deleted by name).

## Final gate, round 1 (this executor) — skeptic-final-1.md change requests 1-3 + non-blocking notes 2-4

- `backend/src/main/scala/com/helio/infrastructure/persistence/auth/ResourcePermissionRepository.scala`
  — CR1: new `deletePublic(resourceType, resourceId)` method, filtering `granteeId.isEmpty` rather
  than `granteeId === UUID.fromString(...)` (which can never match a NULL grantee_id column). This
  is the mechanism that makes a public grant revocable at all.
- `backend/src/main/scala/com/helio/services/auth/PermissionService.scala` — CR1: new
  `revokePublic(dashboardId, user)`, owner-ACL-gated exactly like `revoke`, delegating to
  `permissionRepo.deletePublic`.
- `backend/src/main/scala/com/helio/api/routes/auth/PermissionRoutes.scala` — CR1: new
  `DELETE /api/dashboards/:id/permissions/public` route, matched via a literal `path("public")`
  placed before the UUID-keyed `path(UserIdSegment)` route so it takes precedence and never falls
  through into the `UUID.fromString` 500.
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — CR1: new full-lifecycle test (grant
  public access -> verify anonymously readable -> revoke via the new route -> verify no longer
  readable -> second revoke is 404), confirmed red (500) against the pre-fix code before the fix
  landed. CR3: new export -> import round-trip test for a dashboard with a real Output-bound
  (`kind = "output"`) panel, asserting panels/layout/appearance are identical against the same
  pipeline/Output after re-export.
- `backend/src/test/scala/com/helio/api/routes/dashboards/PublicDashboardRoutesSpec.scala` — CR2:
  new cross-dashboard panel-confinement regression guard on
  `GET /dashboards/:dashboardId/panels/:panelId/rows` — a panel from a different (also-shared)
  dashboard is rejected 404 rather than served. Confirmed red against a naive unscoped
  `findByIdInternal`-style lookup (200, leaking the row) before restoring the real
  `findAllByDashboardId`-scoped implementation.
- `openspec/changes/public-dashboards-export-docs-sweep/specs/pipeline-run-execution/spec.md` — NEW
  spec delta (note 1): the one live spec file with a swept identifier (`output_data_type_id`) that
  had no delta in this change; adds a MODIFIED requirement matching the live heading exactly (kept
  unchanged for archival merge) with a clarifying note on the stale "Type Registry"/"DataType"
  vocabulary in the heading/scenario names, and a naming footnote on the affected scenario.
- `openspec/changes/public-dashboards-export-docs-sweep/tasks.md` — note 2: reworded task 4.2 from
  "Update `docs/agent-native.md`" (this branch changes that file by zero bytes) to "Verify ... already
  current", matching what was actually done.
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — note 3: grammar
  fix, "a output panel requires a outputId" -> "an output panel requires an outputId" (the only
  member of `DataPanelKinds` is `"output"`, so this is deterministic, not a generic-plural bug).
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` — note 4: fixed the stray `///` (triple-slash)
  mid-comment that survived two prior cycles.
