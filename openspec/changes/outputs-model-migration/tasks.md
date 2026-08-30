## 0. Round-2 revisions (skeptic design-gate round 1 findings)

- [ ] 0.1 Add explicit rewire tasks (this section references them; see §3.8-3.12) for
      `PipelineProposalService`, `ProposalPanelSupport`, `DashboardProposalService`,
      `PanelCapabilityService`, `WorkspaceContextService`, `AlertRuleRepository`,
      `PanelRepository`/`PipelineRunService` snapshot writes, and `ApiRoutes.scala`'s
      `"data-type"` ACL registration — see design.md's "scope of the backend proposal
      services" decision.
- [ ] 0.2 Remove the dangling forward-references in the original tasks.md (`Pipeline.
      outputDataTypeId` "deferred to section 6", `AlertRule.targetDataTypeId` "not yet
      replaced") — both now have concrete owning tasks (§3.5, §3.1) in this revision.

## 1. Domain model + new repositories (additive)

- [x] 1.1 Add `Output`, `OutputId`, `OutputKind`, `NodeRef` to `domain/model/model.scala`
      (additive here); `Pipeline.outputDataTypeId` is removed in task 3.5 once
      `PipelineRepository.create` stops minting a type.
- [x] 1.2 Add `parentStepId: Option[PipelineStepId]` to `PipelineStep`.
- [x] 1.3 Add `inferredSchema: Vector[SchemaField]` to `DataSource`.
- [x] 1.4 Add `targetOutputId` to `AlertRule` domain model, additive alongside
      `targetDataTypeId` at this point; `targetDataTypeId` is removed in task 3.1 once
      `AlertRuleService`/`AlertEvaluationService` are rewired to `evaluateForOutput`.
- [ ] 1.5 New `OutputRepository`, `NodeSnapshotRepository`.
- [ ] 1.6 `PipelineStepRepository`: tree-ordered reads (`trunkOf`, `childrenOf`, `tailsOf`),
      sibling-scoped `insert`/`insertAtInternal`/`reorderInternal`, splice-on-delete.
- [ ] 1.7 Unit tests: splice-on-delete (mid-trunk re-link; tail deletion + Output cascade +
      placement count), sibling-scoped insert/reorder, `trunkOf` order preservation.

## 2. Flyway migration V94 (additive schema, full data migration)

- [ ] 2.1 Verify the exact current `panels` column list against
      `PanelRepository.scala:348-387` / `PanelRowMapper.scala` before writing DDL.
- [ ] 2.2 `pipeline_steps.parent_step_id` + backfill from `position` (no `position` reset).
- [ ] 2.3 `outputs` table + sharing-aware RLS (mirrors `pipelines`/V39).
- [ ] 2.4 `node_snapshots` table + RLS mirroring `outputs`.
- [ ] 2.5 `panels.kind` (nullable → backfilled from `type` → `SET NOT NULL`) + `output_id`.
- [ ] 2.6 `data_sources.inferred_schema`.
- [ ] 2.7 `alert_rules`/`alert_events` retarget to `target_output_id`.
- [ ] 2.8 `binary_refs` re-key to `data_source_id`; inspect dev DB first for any ref pointing
      at a pipeline-output type and record the finding in the PR.
- [ ] 2.9 Data migration steps, in ticket order: companion types → inferred_schema; computed
      fields → compute steps (count first, skip+log if zero); bound panels → Outputs (+ tail
      steps for aggregation/metric panels, invalid fieldMapping slots dropped+logged); unbound
      panels deleted (count logged); orphan types → table Outputs; `data_type_rows` →
      `node_snapshots`; alert rules retargeted; patch-set journal entries for `dataType`/`metric`
      deleted.
- [ ] 2.10 Drop `panels`' retired columns; drop `metrics`, `data_types`, `data_type_rows`,
      `pipelines.output_data_type_id`.
- [ ] 2.11 Red-first migration test: build the dev-DB-derived fixture (`pg_dump --data-only`,
      restricted to affected tables, seeded up to the required-shapes checklist), prove it fails
      against pre-migration schema, then passes.
- [ ] 2.12 Step-order-preserved test (5-step pipeline, migrate, compare `trunkOf` order).
- [ ] 2.13 RLS smoke test: non-superuser/non-BYPASSRLS role via test-created `SET ROLE`; owner
      read / grantee read / cross-tenant denial on `outputs` + `node_snapshots`; prove itself red
      by dropping a policy.

## 3. Rewire live consumers (alerts, search, teardown, dashboard contents, assistant, patch sets)

- [ ] 3.1 `AlertRuleService`/`AlertEvaluationService`: `evaluateForDataType` → `evaluateForOutput`,
      invoked per Output of every materialized node from `PipelineRunService.scala:649`. In the
      SAME task, remove `targetDataTypeId` from the `AlertRule` domain model (added additively in
      1.4) now that every caller reads `targetOutputId` instead — round-2 finding 4 flagged this
      removal as dangling; it belongs here, not left implicit.
- [ ] 3.2 `WorkspaceSearchService`, `WorkspaceTeardownRepository`, `DashboardContentsService`,
      `AssistantToolExecutor`: DataType/Metric branches → Outputs.
- [ ] 3.3 `PatchSetApplyService` + other patch-set files: `dataType` targets → node/Output
      targets; persisted enum loses `dataType`/`metric`.
- [ ] 3.4 `BinaryRefRepository` re-keyed to `data_source_id`.
- [ ] 3.5 `PipelineRepository.create` stops minting a type; `PipelineService.create` drops
      `outputDataTypeName`. In the SAME task, remove `Pipeline.outputDataTypeId` from the domain
      model (added additively in 1.1) now that no code path sets or reads it — round-2 finding 4
      flagged this removal as dangling; it belongs here, not left implicit.
- [ ] 3.6 `Panel.scala` + `domain/panels/*Panel.scala` + `package.scala`: bound kinds collapse to
      `OutputPanel`; `PanelBindingSpec` → `OutputBindingSpec` keyed by `OutputKind`.
- [ ] 3.7 `DemoData` reseeded: one source → one pipeline → three Outputs, no unbound panels.
- [ ] 3.8 `PipelineProposalService` (35 refs, `:48` takes `DataTypeService`, `:23` rollback path
      through `DataTypeService.delete`): rewire to create/roll back an Output on the pipeline's
      last trunk step instead of a DataType — see design.md's proposal-service scope decision.
- [ ] 3.9 `ProposalPanelSupport` (26 refs, `:81` `dataTypeRepo`/`MetricRepository`): rewire panel
      resolution to Outputs; drop metric binding resolution (metrics no longer exist).
- [ ] 3.10 `DashboardProposalService` (`:12-13,:44`, also `DataPanelKinds:211` — see §5.7): rewire
      DataType/Metric composition to Outputs. `DataPanelKinds` is a live validation predicate, NOT
      a passive list (round-4 finding) — retarget it to `Set("output")` (the one panel *kind*
      requiring an Output binding), not the old Output-visualization-kind enumeration; the
      `panel.type`-testing call sites at `ProposalPanelSupport.scala:37,157` and
      `CombinedProposalService.scala:123` change only their field reference (`panel.type` →
      keeping the field's NAME unchanged — `ProposalPanel.type` stays `type`; only
      `DataPanelKinds`' own value changes to `Set("output")` (round-4 fix: `panel.kind` does not
      exist; renaming the field would collide with the P1.4-owned boundary on
      `dashboard-proposal.schema.json`, see design.md's `DataPanelKinds` decision). Update
      `CombinedApplyProposalDanglingRefSpec.scala:39` (and any other spec asserting today's
      `DataPanelKinds` membership, e.g. a `chart`-panel scenario) to assert on `type = "output"` in
      the same commit — task 6.4 requires this spec green.
- [ ] 3.10a `ProposalPanelSupport`'s other kind-valued predicates (round-4 finding 2 — same class
      as `DataPanelKinds`, different constants, previously unowned): delete outright, along with
      the code paths they guard, rather than retarget to a value that no longer exists on the
      panel — see design.md's "other kind-valued predicates are retired" decision.
      `ProposalPanelSupport.scala:39,49` (`panel.type == "chart"` gating `validateChartType`/
      `ChartPanel.rejectsAggregation`), `:46,217` (`== TimelineKind` gating timeline `sort`
      validation/config derivation), `:209` (`== MetricKind` gating label/unit derivation), `:136`
      (`MetricIdSupportedKinds`, `DashboardProposalService.scala:219`, itself deleted). Update or
      delete the specs covering each (grep for the deleted symbol names to find them).
- [ ] 3.11 `PanelCapabilityService` (16 refs, `:8` takes `DataTypeRepository` +
      `DataTypeRowRepository`): **KEEP and rewire** — verified directly against the live tree
      (round 3), this is NOT dead code with only the two deleted-route callers a round-2 skeptic
      finding claimed: it is a live constructor dependency of `RefinementGrounding`,
      `DashboardAuthoringService`, `AssistantToolExecutor`, and `AssistantService` (all real
      internal callers, confirmed by `grep -n "PanelCapabilityService"` across
      `backend/src/main/scala/com/helio`), none of which this ticket deletes. Rewire its
      capability computation to resolve against a pipeline node's Outputs instead of a DataType;
      only the public route it used to back (`GET /api/types/:id/panel-capabilities`, deleted in
      §4.1) and `PanelCapabilityProtocol`'s route-facing wire shape go away — the service and its
      four internal callers stay and must keep compiling.
- [ ] 3.11a `PanelCapabilityService`'s test-side blast radius (round-4 finding — task 4.5 only
      covers specs of DELETED files; these belong to KEPT services): rewire the 12 backend spec
      files constructing `new PanelCapabilityService(dataTypeRepo, dataTypeRowRepo)` with the two
      repositories §4.1 deletes — `AssistantToolExecutorSpec`, `AssistantServiceSpec`,
      `RefinementRoutesSpec`, `RefinementServiceSpec`, `DashboardAuthoringRoutesSpec`,
      `DashboardAuthoringServiceSpec`, `AuthoringTelemetrySpec`, `ResourceTaggingSpec`,
      `DataTypeDataSourceAclSpec`, `PipelineRunServiceSpec` to the rewired constructor
      (`PanelCapabilityServiceSpec` and `DataTypeRoutesSpec` are deleted alongside their subjects
      in §4.5, not rewired here). Also update the stale doc comments at
      `PanelBindingSpec.scala:32,103-119` and `PanelCapabilityProtocol.scala:8` that still
      reference the retired introspection endpoint.
- [ ] 3.12 `WorkspaceContextService` (34 refs, `:5` imports `DataTypeService`): rewire every
      DataType/Metric reference to Outputs/pipelines/inferredSchema; do NOT touch `asNumeric`'s
      single-exit-filter structure or its `BigDecimal.setScale` rounding (HEL-631 caution).
- [ ] 3.13 `AlertRuleRepository`: add `listEnabledByOutputInternal` (privileged internal read,
      mirrors today's `listEnabledByDataTypeInternal`) backing task 3.1's `evaluateForOutput`.
- [ ] 3.14 `PanelRepository`/`PipelineRunService`: verify snapshot-writing call sites (not just
      the `:649` alert hook) are rewired to write `node_snapshots` keyed by node, not
      `data_type_rows` keyed by DataType.
- [ ] 3.15 `ApiRoutes.scala`: remove the `"data-type"` `ResourceType` registration (see
      `acl-resource-type-registry` delta) alongside the route deletions in §4.2.

## 4. Delete retired repositories, services, protocols, routes, wiring

- [ ] 4.1 Delete `DataTypeRepository`, `DataTypeRowRepository`, `DataTypeService`,
      `MetricRepository`, `MetricService`, `DataTypeProtocol`, `api/protocols/metrics/*`,
      `DataTypeRoutes`, `MetricRoutes`, `BoundPanelService`,
      `PanelServiceHelpers.withMaterializedMetric`, `PanelService` binding-resolution code.
- [ ] 4.2 Remove wiring in `ApiRoutes.scala` and `Main.scala`.
- [ ] 4.3 Delete `DataSourceService.upsertSourceDataType` / `SourceService`'s second upsert /
      `CreateSourceEnvelope`; replace with `upsertInferredSchema`.
- [ ] 4.4 `RlsPolicyGuardSpec`: add `outputs`/`node_snapshots`, remove `data_types`/
      `data_type_rows`/`metrics`.
- [ ] 4.5 Delete the backend specs for every deleted file above (`MetricRoutesSpec`,
      `PanelMetricBindingRoutesSpec`, `MetricRepositorySpec`, etc. — absorbs HEL-654).
- [ ] 4.6 Split the oversized pipeline service files while open (HEL-689) —
      behavior-preserving; do not touch `WorkspaceContextService.asNumeric`'s structure/rounding.

## 5. Schemas + drift script + OpenSpec (pre-commit gate)

- [ ] 5.1 Delete `schemas/metrics/`, `schemas/data-types/` (moving
      `data-type-assertion-status` → `schemas/outputs/output-assertion-status.schema.json`).
- [ ] 5.2 Reshape `schemas/panels/panel.schema.json` + `create-panel-request` + batch
      request/response to the placement model (`kind`/`outputId`); delete
      `bound-panel-request/response`, `panel-capabilities-response`, `panel-query`.
- [ ] 5.3 Re-target `schemas/alerts/*` to `targetOutputId`.
- [ ] 5.4 Update `scripts/check-schema-drift.mjs` (its own line numbers, cited below — NOT the
      target files' line numbers, a round-3 citation error corrected in round 4) in the SAME
      commit as 4.1/5.1/5.2/3.6/3.10 — five concrete, independently-breaking pieces (see design.md's
      Gate-Chain Implications Checklist for the full technical detail):
      (a) the hard arm-count guard at `check-schema-drift.mjs:205` (`< 8` → `< 5` or `=== 5`,
      update its error message);
      (b) the `extractBetween` markers at `check-schema-drift.mjs:195-199` if task 3.6 renames
      `PanelType`/its `fromString`/`asString` methods;
      (c) the four `panelTypeSurfaces` JSON pointers at `check-schema-drift.mjs:232-263`
      (`create-panel-request.schema.json`, `panel.schema.json`,
      `update-panels-batch-request.schema.json`) re-pointed from `properties.type.enum` to
      `properties.kind.enum` to match task 5.2's field rename;
      (d) `dashboard-proposal.schema.json`'s `$defs.ProposalPanel.properties.type.enum` (checked at
      `check-schema-drift.mjs:255-263`, compared against `agentFacingPanelTypes`) — value and
      ownership are task 5.7's, not restated here (round-4 fix: this bullet previously said "the
      new kind set," 5 values including `divider`, while 5.7 says `agentFacingKinds`, 4 values;
      the drift script compares this exact pointer against `agentFacingPanelTypes`, so 5.7's value
      is the only one that keeps the gate green — this file's OTHER changes stay P1.4's, only this
      one enum array is touched here);
      (e) the two `dataPanelTypeSurfaces` arrays — `helio-mcp/src/tools/proposalValidation.ts:19`
      (`DATA_PANEL_TYPES`) and `frontend/.../ProposalReview.tsx:29,60,146` (`DATA_PANEL_TYPES`),
      checked at `check-schema-drift.mjs:275-297` — updated to `["output"]`, matching task 3.10's
      corrected `DataPanelKinds` retarget (NOT the six-visualization-kind set a round-3 draft of
      this task named — that would invert the validation, see design.md's round-4 finding).
- [ ] 5.5 Delete/rewrite backend-facing OpenSpec capability specs — this ticket owns all 71
      capability deltas in this change's own `specs/` directory (round 3, full 115-file
      enumeration — see `openspec-coverage-checklist.md` for the authoritative per-capability
      classification: 65 of the 115 grep-matched files delta'd here, plus 6 further capability
      dirs not matched by the literal grep, 50 explicitly deferred to a named P-ticket, 1
      verified no-op); run `openspec archive` at delivery time to apply them, not before.
- [ ] 5.6 `check:schemas`, `check-schema-drift.mjs`, `check:openspec`, `check:openspec:selftest`
      green.
- [ ] 5.7 Mechanical constant/enum edit for the OTHER cross-surface arrays (NOT a feature
      rewrite — see design.md's Gate-Chain decision; `DataPanelKinds` itself is task 3.10's job,
      not this one, since it is a live predicate, not a passive list): update
      `helio-mcp/src/tools/proposal.ts:28`'s `PANEL_TYPES` to the new `agentFacingKinds` (new
      `kind` set minus `divider`: `output, text, markdown, image`), and
      `dashboard-proposal.schema.json`'s `$defs.ProposalPanel.properties.type.enum` to the same
      `agentFacingKinds` set — in the SAME commit as 5.4/3.6/3.10, so `check-schema-drift.mjs`'s
      cross-surface check and `check:helio-mcp-types`/frontend `typecheck` stay green. No other
      change to these files' logic/UX in this ticket.

## 6. Final verification

- [ ] 6.1 `grep -rn` acceptance-criteria pattern over `backend/src` returns nothing but migration
      files (Spark's own `DataType` import excluded).
- [ ] 6.2 `grep -rn "DataType\|Metric" openspec/specs` returns nothing except the exact 50 files
      named in `openspec-coverage-checklist.md`'s deferred/no-op lists (9 → P1.4, 18 → P1.5,
      22 → P1.6, 1 no-op) — any other survivor is a real gap, not an acceptable residual.
- [ ] 6.3 `check:scala-quality` clean; no inline FQNs.
- [ ] 6.4 `sbt compile` and `sbt test` green.
- [ ] 6.5 File a follow-up obligation for each of the 49 deferred capabilities (not the 1 no-op)
      where the owning ticket's implementer will actually see it, not just in this change's
      docs: add a one-line pointer to `openspec-coverage-checklist.md`'s relevant section in a
      comment on HEL-907/HEL-908/HEL-909 (as appropriate) at PR-merge time, so a deferred spec
      isn't silently forgotten between now and that ticket's own Planning phase.
- [ ] 6.6 State in the PR: computed-field count found (skip+log if zero), any binary_refs
      pointing at pipeline-output types (and how they were keyed), and link
      `openspec-coverage-checklist.md` as the authoritative record of the full 115-file
      OpenSpec surface.
