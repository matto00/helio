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
- [x] 1.5 New `OutputRepository`, `NodeSnapshotRepository` — compiling scaffolding against
      the planned `outputs`/`node_snapshots` schema; both tables land in the V94 migration
      (task 2.3/2.4), so no runtime DB test exists for these yet (deferred to land alongside
      2.3/2.4).
- [x] 1.6 `PipelineStepRepository`: tree-ordered reads (`trunkOf`, `childrenOf`, `tailsOf`)
      added as pure functions over an already-fetched `Vector[PipelineStep]`, walking
      `parentStepId` (task 1.2). **DB-backed remainder landed this cycle** (2.2's
      `parent_step_id` column has been stable a cycle): `rowToDomain` now reads/decodes the
      real `parent_step_id` column into every step's `parentStepId` (previously always
      `None` regardless of the DB value — the column existed since 2.2 but nothing read it
      yet). `insertInternal`/`insertAtInternal` gained an optional `parentStepId` param and
      are now genuinely sibling-scoped (`position` computed/renumbered only among steps
      sharing the same `parentStepId`, not the whole pipeline) via a new `siblingsQuery`
      helper. `deleteInternal` now performs splice-on-delete per ticket.md's repository
      semantics (`parent_step_id` has no `ON DELETE CASCADE`): the deleted step's position-0
      child is re-parented into its slot; every other child (a tail) and its full descendant
      subtree is deleted outright. **Signature change:** `deleteInternal` now returns
      `Future[Option[Int]]` (`None` = step didn't exist, `Some(removedTailStepCount)` on
      success) instead of `Future[Boolean]`, to carry the "returns the placement count
      removed so P1.3 can warn" requirement from ticket.md's repository-semantics section —
      its sole live caller (`PipelineService.deleteStep`) was updated to match (does not
      consume the count yet; only presence/absence). `reorderInternal`/`insert`/`delete`
      (owner-scoped, unused by any live caller today) left as-is — `reorderInternal` is
      already implicitly sibling-scoped by construction (it only ever touches the ids named
      in `orderedIds`).
- [x] 1.7 Unit tests for `trunkOf`/`childrenOf`/`tailsOf` (pure-function coverage: empty
      pipeline, pure trunk, branch-point tail-ignoring, pre-backfill degrade-to-root-list,
      sibling ordering, multi-tail depth-first expansion) —
      `PipelineStepRepositoryTreeOrderingSpec` (8 tests, all green). **DB-backed remainder
      landed this cycle**: `PipelineStepRepositorySpliceSpec` (5 tests, all green) — sibling-
      scoped `insertInternal` position isolation across sibling groups, sibling-scoped
      `insertAtInternal` splice leaving other groups untouched, splice-on-delete re-parenting
      the head child (trunk stays connected, proved via `trunkOf`), splice-on-delete deleting
      a tail's full subtree with the correct removed count, and the not-found `None` case.

## 2. Flyway migration V94 (additive schema, full data migration)

- [x] 2.1 Verified the exact current `panels` column list against
      `PanelRepository.scala:348-387` / `PanelRowMapper.scala`: `type, type_id, field_mapping,
      aggregation, metric_id, metric_label, metric_unit, chart_options, collection_options,
      timeline_options, column_widths, table_density, column_order, chart_annotation` —
      matches the ticket's own citation exactly, `table_display_config` confirmed absent.
- [x] 2.2 `pipeline_steps.parent_step_id` added (nullable, FK to itself) + backfilled from
      `position` order (each step's parent = the step immediately before it in position order;
      position 0 = NULL/root). `position` itself is untouched. V94
      (`backend/src/main/resources/db/migration/V94__outputs_model.sql`).
- [x] 2.3 `outputs` table + sharing-aware RLS (mirrors `pipelines`/V39 `helio_can_access_pipeline`
      exactly — SELECT is sharing-aware, INSERT/UPDATE/DELETE are owner-only via `WITH
      CHECK`/`USING`). Same V94 file.
- [x] 2.4 `node_snapshots` table + RLS mirroring `outputs` (not `data_type_rows`'s owner-only V35
      policy — sharing-aware via the parent pipeline, per design.md). Partial-unique-index pair
      (keyed vs. root, since Postgres UNIQUE treats NULL as distinct) instead of a single
      compound UNIQUE. Same V94 file.
- [x] 2.5 (partial) `panels.kind` added nullable, backfilled from `type` (bound viz kinds +
      data-bound `text` → `output`; literal `text`/markdown/image/divider pass through), +
      `output_id` (nullable FK, not yet populated — that's task 2.9). **`SET NOT NULL` deferred**
      to land in the same commit as task 3.6 (the Panel-model rewire) — verified empirically this
      cycle that adding it now 500s every existing panel-insert code path (11 spec failures on a
      full `sbt test` run, all NOT NULL violations on `kind`), since no current write path
      populates it yet. See the migration file's own comment at that line for the full rationale.
      Same V94 file.
- [x] 2.6 `data_sources.inferred_schema` added (`JSONB NOT NULL DEFAULT '[]'`) — every
      pre-existing row reads back as `Vector.empty`, matching task 1.3's domain default, with no
      backfill pass needed. Same V94 file.
- [x] 2.7 (partial) `alert_rules`/`alert_events` gained a nullable `target_output_id` (FK to
      `outputs`, indexed) alongside the untouched `target_data_type_id` — same additive-first
      pattern as 2.2-2.6. Actual retarget (populating `target_output_id` from each rule's
      current target) is task 2.9's DML; dropping `target_data_type_id` is task 2.10's job,
      deferred until section 3.1's consumer rewire lands (decision 1e). Same V94 file.
- [x] 2.8 (partial) `binary_refs` gained nullable `pipeline_id`/`node_step_id` columns
      alongside the untouched `data_type_id`. **Dev DB inspection finding (recorded per the
      ticket's own fallback instruction):** the shared dev DB's one live `binary_refs` row
      points at a pipeline-output type, not a companion type — and `PipelineRunService.scala:650`
      is the SOLE writer of `BinaryRefRepository.overwriteForDataType` in the codebase today,
      always keyed by a pipeline's `outputDataTypeId`. There is no companion-type writer to
      re-key against `data_source_id` at all. Per ticket.md's explicit fallback ("if any do,
      key those by (pipeline_id, node_step_id) instead and say so in the PR"), keyed by node
      instead of `data_source_id`. RLS rewrite (currently selects from `data_types`) deferred
      to land with 2.9/2.10, same as `target_data_type_id`'s drop. Same V94 file.
- [x] 2.9 Data migration steps, in ticket order: companion types →
      inferred_schema (DONE cycle 5, red-first tested in `V94OutputsMigrationSpec`); bound panels
      → Outputs (+ tail steps for aggregation/metric panels, invalid fieldMapping slots
      dropped+logged) (DONE cycle 7); unbound panels deleted (count logged, DONE cycle 8);
      `data_type_rows` → `node_snapshots` under each pipeline's original last-trunk-step (DONE
      cycle 8); computed fields → compute steps for pipeline-output types, sibling-attached to the
      original last-trunk-step — companion-type case is a documented no-op, 0 rows in the dev DB
      (DONE cycle 8); orphan pipeline-output types (no bound panel) → table Outputs (DONE cycle 8);
      alert rules/events retargeted to the lowest-position Output on their type's node (DONE
      cycle 8); patch-set journal entries for `dataType`/`metric` deleted (DONE cycle 8, count
      logged: 0 in the dev DB, implemented generically anyway and red-first tested against a
      synthetic fixture). All red-first tested in `V94OutputsMigrationSpec` — see
      execution-progress.md cycle 8. **2.10 (the drops) remains explicitly NOT started** — blocked
      on sections 3/4's consumer rewires (decision 1e).
- [ ] 2.10 Drop `panels`' retired columns; drop `metrics`, `data_types`, `data_type_rows`,
      `pipelines.output_data_type_id`.
- [x] 2.11 (partial) Red-first migration test for the additive slice landed so far —
      `V94OutputsMigrationSpec`: hand-built fixture (not yet a real `pg_dump --data-only` of the
      shared dev DB — that operational step is outside this cycle's reach; a genuine `pg_dump`
      fixture should replace/augment this once 2.9's full data migration exists to test against),
      migrates to V93, asserts the pre-migration schema genuinely lacks the new columns/tables
      (proves non-vacuousness), migrates to V94, asserts the backfills. Will grow alongside the
      migration file as 2.7-2.10 land.
- [x] 2.12 Step-order-preservation test: 5-step pipeline seeded pre-migration, migrated, walks
      `parent_step_id` from the root and confirms it exactly reproduces the original `position`
      order — same spec, `"V94 pipeline_steps.parent_step_id backfill"`.
- [x] 2.13 (partial) RLS smoke test for `outputs`: a real non-superuser, non-BYPASSRLS role
      (`helio_app_test_v94`, created by the test itself via `SET ROLE`) proves owner read works
      and cross-tenant read is denied; then proves itself red by dropping `outputs_select` and
      confirming access disappears, then restoring it and confirming access returns. Same spec.
      **`node_snapshots`' RLS is not yet covered by an equivalent smoke test** — deferred to when
      real snapshot data exists post-2.9 (currently no writer path populates it).

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
