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
      the step with no matching parent-by-position = NULL/root). **Narrowed per the 2026-08-31
      binding ruling (design.md's "position renumbering ruling"): step ORDER, carried by
      `parent_step_id`, is preserved exactly; `position` itself is NOT left untouched — every
      step (root included) is renumbered to `0` immediately after the backfill, while each is
      still its parent's sole child, so `trunkOf` can require an exact `position == 0` match
      once migration-created tails (`position >= 1`) exist.** V94
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
- [x] 2.10 Drop `panels`' retired columns (`type, type_id, field_mapping, aggregation,
      metric_id, metric_label, metric_unit, chart_options, collection_options,
      timeline_options, column_widths, table_density, column_order, chart_annotation`); drop
      `metrics`, `data_type_rows`, `data_types`; drop `pipelines.output_data_type_id`. Landed
      as the tail of the same V94 migration file (sections 17-21), immediately after a
      prerequisite `panels.kind SET NOT NULL` (section 17) that closed a gap task 3.6 had
      deferred but never actually landed: `PanelRowMapper.domainToRow` was still writing
      `kind = None` for every non-Output panel (text/markdown/image/divider), with
      `rowToDomain` still falling back to the (about-to-be-dropped) `type` column for those
      kinds' dispatch. Fixed inline (not a design-reopen — same shape as 3.6's own intent,
      just completing it) by making `domainToRow` always set `kind = p.kind` and
      `rowToDomain` dispatch purely on `row.kind`, before adding the `NOT NULL` constraint.
      Also required, discovered via grep-before-drop (not anticipated by the ticket's own
      column list): `alert_rules.target_data_type_id` FK-references `data_types(id) ON
      DELETE CASCADE` (V60) — design.md decision 2 already flags "alert rules retarget must
      precede dropping the target_data_type_id FK" — dropped both `alert_rules`/
      `alert_events.target_data_type_id` alongside it (zero application-code readers
      survived task 3.1); `binary_refs.data_type_id`'s RLS policy (`binary_refs_owner`, V46)
      selected from `data_types` directly and had to be replaced with a
      `pipeline_id`/`helio_can_access_pipeline`-keyed policy before the column/table could
      drop (Postgres refuses to drop a table a policy still references).
      `SourceSchemaHealthCheck` (HEL-256, `backend/src/main/scala/com/helio/app/
      SourceSchemaHealthCheck.scala`) was deleted outright (+ its Main.scala call site + its
      spec) — its entire purpose (flagging a `data_sources` row with no linked `data_types`
      companion) is meaningless once the companion-DataType concept is gone.
      `PanelRepository`'s Slick `PanelTable`/`PanelRow`/`configColumnsOf`/
      `configColumnValuesOf` were slimmed to the 6 surviving config columns (all 14 retired
      columns were already always `None` in every write — confirmed via
      `PanelRowMapper.domainToRow` before touching the schema).
      `PipelineRepository.setOutputDataTypeIdInternalForTest`/`findOutputDataTypeIdInternal`
      and `PipelineRunRepository.findLatestRunIdByOutputDataTypeIdInternal` deleted outright
      (dead: zero production callers survived task 4.1). ~50 test files' raw-SQL fixtures
      (`INSERT INTO data_types`/`pipelines.output_data_type_id`/panels' `type`/`type_id`
      literal-value inserts, `DELETE`/`TRUNCATE` cleanup lists) updated to drop references to
      the now-gone tables/columns — three specs pinned to an OLDER Flyway `.target(...)`
      version (`ResourceTagMigrationSpec` V72/V93, `TriggerSourceMigrationSpec` V62,
      `PipelineOnlyPanelBindingMigrationSpec` V93) were correctly left untouched after an
      automated first-pass script wrongly stripped their (legitimately still-live-at-that-
      schema-version) `data_types` fixtures — caught via a second `.target(` sweep before
      running the suite, and `git checkout`-reverted rather than hand-repaired. New red-first
      coverage: `V94OutputsMigrationSpec`'s own "V94 task 2.10" describe-block asserts every
      dropped table/column via `information_schema` + `pg_policies` (8 assertions). Full
      `sbt test` (single-threaded, HEL-924 protocol) confirmed 3360/3360 green, run twice.
- [x] 2.11 (complete, cycle 3 rewrite) Red-first migration test: `V94OutputsMigrationSpec` migrates
      to V93, asserts the pre-migration schema genuinely lacks the new columns/tables (proves
      non-vacuousness), migrates to V94, asserts the backfills. Per the human coordinator's explicit
      cycle-3 ruling, the fixture is now a REAL `pg_dump --data-only` snapshot of the shared dev DB
      (V93, 2026-08-30, `backend/src/test/resources/db/fixtures/hel904-real-dump.sql`), loaded
      verbatim — REPLACING, not supplementing, the previous ~800-line hand-built fixture (design.md
      decision 3 is now fully satisfied, not partial). Only two things are seeded on top of the dump:
      two `alert_rules` rows (the dev DB carries zero) and one `resource_permissions` grant (for the
      RLS sharing-branch test, which needs a deliberately-controlled grantee). Building the real
      fixture immediately surfaced a SECOND real defect beyond evaluation-2's markdown-binding gap:
      the data-bound-markdown fix itself (see file header note in V94's migration SQL) plus a
      test-authoring bug in this cycle's own first draft (an "orphan pipeline-output type" id was
      picked wrong twice — once picking a data_type with no owning pipeline at all, which never
      reaches the orphan-Output path, and once reusing an RLS "other-tenant" user id that happened to
      already own the pipeline under test) — both caught and fixed via the real fixture's own
      assertions failing, not assumed correct. 23/23 assertions green against the real data.
- [x] 2.12 Step-order-preservation test: 5-step pipeline seeded pre-migration, migrated, walks
      `parent_step_id` from the root and confirms it exactly reproduces the original `position`
      order — same spec, `"V94 pipeline_steps.parent_step_id backfill"`.
- [x] 2.13 RLS smoke test, complete as of cycle 31: a real non-superuser, non-BYPASSRLS role
      (`helio_app_test_v94`, created by the test itself via `SET ROLE`) proves, on BOTH `outputs`
      and `node_snapshots`: owner read works, cross-tenant read is denied, and each policy proves
      itself red (drop the SELECT policy, confirm access disappears, restore it, confirm access
      returns). A third, previously-unproven branch is now covered on both tables: a real
      `resource_permissions` grant (`resource_type = 'pipeline'`) seeded for a user who is neither
      the owner nor the denied other-tenant proves the SHARING branch of `helio_can_access_pipeline`
      — the specific reason this migration chose V39-mirroring sharing-aware RLS over V35 owner-only
      — actually works, confirming the grantee is denied before the grant exists and allowed after.

## 3. Rewire live consumers (alerts, search, teardown, dashboard contents, assistant, patch sets)

- [x] 3.1 `AlertRuleService`/`AlertEvaluationService`: `evaluateForDataType` → `evaluateForOutput`,
      invoked per Output of every materialized node from `PipelineRunService.scala:649`. In the
      SAME task, remove `targetDataTypeId` from the `AlertRule` domain model (added additively in
      1.4) now that every caller reads `targetOutputId` instead — round-2 finding 4 flagged this
      removal as dangling; it belongs here, not left implicit.
- [x] 3.2 `WorkspaceSearchService`, `WorkspaceTeardownRepository`, `DashboardContentsService`,
      `AssistantToolExecutor`: DataType/Metric branches → Outputs (or removed outright where the
      OpenSpec delta calls for removal, not retargeting). **Completed this cycle (cycle 23).**
      `AssistantToolExecutor`'s `withCapabilities` needed no further change (resolved as a side
      effect of 3.11 landing, per cycle 22's note — it already threads a `DataTypeId` wrapper,
      which `PanelCapabilityService` now correctly reinterprets as an Output id).
      `WorkspaceSearchService`'s Metric branch is REMOVED outright (not retargeted) per the
      `workspace-resource-search` OpenSpec delta's "DataTypes and Metrics are no longer a
      searchable kind" scenario: `metricService`/`MetricService` dropped from the constructor
      (same positional slot removed, not replaced), `metricSummariesF`/`toMetricSummary`/
      `toMetricDetail`/the `WorkspaceResourceType.Metric` `getResource` case all deleted;
      `WorkspaceResourceType.Metric` itself (the case object, `asString`/`fromString` cases) and
      the wire-level `WorkspaceResourceMetric`/`WorkspaceResourceDetail.MetricDetail` protocol
      types are deleted too (both were used ONLY by this one branch, confirmed by a fresh grep —
      leaving them would be orphaned dead code, not a "kept for later" case); `MetricProtocol` mix-in
      dropped from `WorkspaceResourceSearchProtocol` accordingly. `WorkspaceAssistantTools`'
      `ResourceTypeEnum` drops `"metric"` (Claude can no longer propose it as a `find`/`get_resource`
      type). `ApiRoutes.scala`'s `assistantServiceOpt` gating is simplified to depend on
      `ClaudeConfig.fromEnv()` alone (the `metricServiceOpt` gating dimension existed ONLY to
      guarantee `WorkspaceSearchService`'s now-removed `metricService` constructor arg was
      non-null — `metricServiceOpt` itself is UNCHANGED and still gates the still-live `/api/metrics`
      routes, a section-4 job). `WorkspaceTeardownRepository`'s `resourceKind = "data_type"` branch
      is REMOVED outright per the `workspace-tag-teardown` OpenSpec delta ("Outputs are torn down
      transitively via `ON DELETE CASCADE` from their owning pipeline" — verified directly against
      V94's `outputs.pipeline_id ... ON DELETE CASCADE`): `dataTypeRepo` dropped from the
      constructor, `taggedTypes`/`typeDependentConflicts`/`sourceLinkConflicts`/
      `panelBoundConflicts`/`deleteTypes`/`typesDeleted` all deleted; delete order simplifies to
      Pipelines → DataSources. `typesDeleted` is removed from `TeardownOutcome`,
      `TeardownResponse` (wire shape, `jsonFormat8` → `jsonFormat7`), and
      `schemas/workspace/workspace-teardown-response.schema.json` (also narrows
      `TeardownConflict.resourceKind`'s enum to `["data_source"]` — the only kind still carrying a
      guard). `DashboardContentsService`'s `metricRepo: MetricRepository` constructor param is
      REMOVED outright — a pre-existing dead param, unused in the file body since task 3.9 already
      dropped `preValidateBindings`'/`validateMetricBinding`'s own `metricRepo` parameter; the
      file's `dataTypeRepo` param is UNCHANGED and correctly kept (still legitimately backs
      `ProposalPanelSupport.preValidateBindings`'s non-`"output"`-kind panel-binding branch, e.g.
      Text/Markdown panels bound to a legacy DataType — that composition is not a "DataType branch
      to retarget," it's live, in-scope-elsewhere behavior task 3.2 does not touch).
- [x] 3.3 `PatchSetApplyService` + other patch-set files: `dataType` targets → node/Output
      targets; persisted enum loses `dataType`/`metric`. **Completed this cycle (cycle 23), with a
      documented correction to the plan above:** per design.md's removal list (which groups
      `PatchSetApplyService` under "the DataType/Metric branches of ... are deleted", NOT
      "retargeted to Outputs" like its four §3.2 siblings) and its delivery-strategy table
      ("Proposal and patch-set schemas ... owned by P1.4, not P1.3"), `dataType` is REMOVED
      outright as a valid `target.kind` -- NOT retargeted onto an `output` kind. Adding real
      `output`-kind patch-set support is P1.4/HEL-907's job (there is no `UpdateOutputRequest`/
      Output-editing route to retarget onto yet -- the Output editor itself is deferred to P1.5
      per design.md's removal-list note). `metric` was already not a recognized `target.kind`
      (unaffected). The V94 migration (cycle 20, `## 15. Patch-set journal cleanup`) already
      purged every persisted journal entry whose `targetKind` was `dataType`/`metric` -- this
      task's remaining job, confirmed by that migration's own trailing comment, was exactly
      "narrowing the recognizedKinds enum and the consumer rewire," done in full this cycle:
      `PatchSetProtocol.recognizedKinds` drops `"dataType"` (`Edit.dataTypePatch`/
      `UpdateDataTypeRequest` removed from the wire case class outright); `PatchSetApplyResolvers`'
      `resolveDataTypeUpdate`/`resolveDataTypeDelete` and `ResolvedAction.DataTypeUpdate`/
      `DataTypeDelete` deleted (an unrecognized `target.kind` now falls through resolvers' own
      pre-existing generic `"unsupported target.kind '$kind' for op '$op'"` rejection);
      `PatchSetApplyForward`/`PatchSetApplyRollback`/`PatchSetPreviewProjection`/
      `PatchSetPreviewImpact`/`PatchSetUndoConflictCheck`/`PatchSetUndoService`/
      `PatchSetUndoInverse` all lose their now-unreachable `dataType` branches/hint/hcontent-check
      code; `RefinementEditShape`'s Claude-facing prompt text no longer documents `"dataType"` as a
      valid target.kind or update-patch example. The now-dead `dataTypeService`/`metricRepo`-style
      constructor params this uncovered (`PatchSetApplyServices.dataTypeService`,
      `PatchSetUndoContext.dataTypeRepo`, `PatchSetUndoService`'s `dataTypeService`/`dataTypeRepo`
      params, `PatchSetApplyServiceJson`'s `DataTypeProtocol` mixin) are removed outright too --
      `PatchSetApplyContext.dataTypeRepo`/`dataTypeService` (on `PatchSetApplyService` itself) are
      KEPT, since `PatchSetApplyResolvers`' panel-binding validation (`rejectCompanionBinding`,
      unrelated to target.kind) still legitimately reads `dataTypeRepo` for non-`"output"`-kind
      panel bindings (Text/Markdown panels bound to a legacy DataType) -- a live, in-scope-
      elsewhere composition, not a "DataType branch to retarget." Test fallout across 8 spec files
      (`PatchSetProtocolSpec` gains 2 new tests asserting `dataType`/`metric` are rejected;
      `PatchSetApplyServiceSpec`/`PatchSetPreviewServiceSpec`/`PatchSetUndoServiceSpec` each lose
      or rewrite the handful of scenarios that specifically exercised the now-retired
      dataType-target content checks/hints/rollback-unrecoverable path, substituting an equivalent
      `dataSource`-delete scenario where the test's actual point was "unrecoverable delete rollback
      reported honestly," not anything DataType-specific) -- verified via a fresh, isolated
      `testOnly` run of the whole `com.helio.services.patchsets`/`com.helio.api.protocols.
      patchsets`/`com.helio.api.routes.patchsets` package tree (113/113 green) plus a full,
      single-threaded `sbt test` (3613/3613 green, confirmed twice -- see this cycle's own
      execution-progress.md entry for the exact count/rationale vs. cycle 22's 3628).
- [x] 3.4 `BinaryRefRepository` re-keyed to `(pipeline_id, node_step_id)` (per
      design.md's documented dev-DB fallback, not `data_source_id` — see
      cycle 8's finding).
- [x] 3.5 `PipelineRepository.create` stops minting a type; `PipelineService.create` drops
      `outputDataTypeName`. In the SAME task, remove `Pipeline.outputDataTypeId` from the domain
      model (added additively in 1.1) now that no code path sets or reads it — round-2 finding 4
      flagged this removal as dangling; it belongs here, not left implicit. Landed cycle 19: V94
      (folded in cycle 20 per decision 2's single-migration-file rule — was briefly a separate
      V95 file) relaxes `pipelines.output_data_type_id` to nullable (column stays, task 2.10/section 4 still
      owns the eventual drop); `CreatePipelineRequest`/`PipelineSummaryResponse`/
      `PipelineAnalyzeResponse` drop `outputDataTypeName`/`outputDataTypeId`; `PipelineRepository`
      gained `findOutputDataTypeIdInternal`/`setOutputDataTypeIdInternalForTest` for the still-live
      legacy DataType read/write paths (`PipelineRunService.onUnblockedRunSuccess`, and tests
      exercising pre-3.12 DataType behavior).
- [x] 3.6 `Panel.scala` + `domain/panels/*Panel.scala` + `package.scala`: bound kinds
      collapse to `OutputPanel`; `PanelBindingSpec` → `OutputBindingSpec` keyed by `OutputKind`.
      **Write-path increment landed this cycle** (cycle 15): `PanelType` (model.scala) gains
      `Output`/`"output"` as a 10th valid value (additive, NOT the eventual 5-value collapse —
      see model.scala's own doc comment on `PanelType` for the full rationale/deferral), wired
      through `PanelConfigCodec` (`OutputCreate`, `decodeCreateConfig`/`encodeConfig`/
      `applyConfigPatchUnsafe` cases) and `PanelServiceHelpers.buildNewPanel` /
      `DashboardSnapshotRepository`'s create-config match so `POST /api/panels` with
      `type: "output"` now actually constructs, persists (`PanelRowMapper` was already wired,
      cycle 12/13), and round-trips a real `OutputPanel`. `check-schema-drift.mjs`'s
      `panelTypeSurfaces`/`agentFacingPanelTypes` are kept green by additively including
      `"output"` in `schemas/panels/{create-panel-request,panel,update-panels-batch-request}.
      schema.json`, `schemas/dashboards/dashboard-proposal.schema.json`'s `ProposalPanel` enum,
      and `helio-mcp/src/tools/proposal.ts`'s `PANEL_TYPES` — in the SAME commit. **Still NOT
      done**: the five old bound `*Panel.scala` files (`MetricPanel`/`ChartPanel`/`TablePanel`/
      `CollectionPanel`/`TimelinePanel`) are NOT yet deleted (still live constructor targets for
      the other 9 `PanelType` values), `PanelBindingSpec` → `OutputBindingSpec` is NOT yet cut
      over, and `PanelType`'s eventual 5-value collapse (dropping the five old bound values
      entirely) was deferred at cycle 15 to land together with tasks 3.9/3.10/3.10a/4.1 — see
      execution-progress.md cycle 14's sizing (15+ real-source-file blast radius: `BoundPanelService`,
      `PanelCapabilityService`, `ProposalPanelSupport`, `DashboardProposalService`, `PatchSet*`,
      `DemoData`) and cycle 15's own note on why option (b) (additive, not full collapse) was
      chosen for that increment. **Completed in full at commit `fb7593d9`** (cycle 16): the five
      old bound `*Panel.scala` files are deleted, `PanelBindingSpec` → `OutputBindingSpec` cut
      over, and `PanelType`/`Panel.Registry`/`PanelKind` collapsed to the final 5-value set
      (output|text|markdown|image|divider) — verified directly against the live tree this cycle
      (files deleted, `OutputBindingSpec.scala` present, `PanelBindingSpec.scala` absent).
- [x] 3.7 `DemoData` reseeded: one source → one pipeline → three Outputs, no unbound panels.
- [x] 3.8 `PipelineProposalService` (35 refs, `:48` takes `DataTypeService`, `:23` rollback path
      through `DataTypeService.delete`): rewire to create/roll back an Output on the pipeline's
      last trunk step instead of a DataType — see design.md's proposal-service scope decision.
- [x] 3.9 `ProposalPanelSupport` (26 refs, `:81` `dataTypeRepo`/`MetricRepository`): rewire panel
      resolution to Outputs; drop metric binding resolution (metrics no longer exist). **Completed
      at commit `fb7593d9`** (cycle 16) — verified this cycle: no `MetricRepository`/metric-binding
      references remain in the file.
- [x] 3.10 `DashboardProposalService` (`:12-13,:44`, also `DataPanelKinds:211` — see §5.7): rewire
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
      the same commit — task 6.4 requires this spec green. **Completed at commit `fb7593d9`**
      (cycle 16) — verified this cycle: `DataPanelKinds: Set[String] = Set("output")` at
      `DashboardProposalService.scala:166`.
- [x] 3.10a `ProposalPanelSupport`'s other kind-valued predicates (round-4 finding 2 — same class
      as `DataPanelKinds`, different constants, previously unowned): delete outright, along with
      the code paths they guard, rather than retarget to a value that no longer exists on the
      panel — see design.md's "other kind-valued predicates are retired" decision.
      `ProposalPanelSupport.scala:39,49` (`panel.type == "chart"` gating `validateChartType`/
      `ChartPanel.rejectsAggregation`), `:46,217` (`== TimelineKind` gating timeline `sort`
      validation/config derivation), `:209` (`== MetricKind` gating label/unit derivation), `:136`
      (`MetricIdSupportedKinds`, `DashboardProposalService.scala:219`, itself deleted). Update or
      delete the specs covering each (grep for the deleted symbol names to find them). **Completed
      at commit `fb7593d9`** (cycle 16) — verified this cycle: `MetricKind`/`TimelineKind`/
      `MetricIdSupportedKinds`/`ChartPanel` are all absent from both files (only historical
      code-comments mentioning their removal remain).
- [x] 3.11 `PanelCapabilityService` (16 refs, `:8` takes `DataTypeRepository` +
      `DataTypeRowRepository`): **KEEP and rewire** — verified directly against the live tree
      (round 3), this is NOT dead code with only the two deleted-route callers a round-2 skeptic
      finding claimed: it is a live constructor dependency of `RefinementGrounding`,
      `DashboardAuthoringService`, `AssistantToolExecutor`, and `AssistantService` (all real
      internal callers, confirmed by `grep -n "PanelCapabilityService"` across
      `backend/src/main/scala/com/helio`), none of which this ticket deletes. Rewire its
      capability computation to resolve against a pipeline node's Outputs instead of a DataType;
      only the public route it used to back (`GET /api/types/:id/panel-capabilities`, deleted in
      §4.1) and `PanelCapabilityProtocol`'s route-facing wire shape go away — the service and its
      four internal callers stay and must keep compiling. **Completed this cycle**: constructor
      rewired to `(outputRepo: OutputRepository, nodeSnapshotRepo: NodeSnapshotRepository)` (same
      positional slot); `getCapabilities`'s public parameter type is DELIBERATELY left as
      `DataTypeId` (not `OutputId`) — see the class's own doc comment — since every caller
      (the still-live route, `RefinementGrounding`, `DashboardAuthoringService`,
      `AssistantToolExecutor`) already threads a bare id string sourced from
      `WorkspaceContextDataType.id` (itself an Output id since task 3.12) through a
      `DataTypeId(...)` wrapper; `id.value` is reinterpreted as an `OutputId` internally (safe,
      both are opaque `String` wrappers over the same id space post-3.12). `isPipelineOutput` is
      now unconditionally `true` (an Output has no source-companion concept) — the V41-mirroring
      "not-pipeline-output" branch is dead-but-harmless, never reached. Zero call-site signature
      changes needed at any of the four internal callers or `ApiRoutes.scala`'s route wiring.
- [x] 3.11a `PanelCapabilityService`'s test-side blast radius (round-4 finding — task 4.5 only
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

      **Completed this cycle, with one deliberate correction to the plan above**: all 12 listed
      spec files rewired onto `(outputRepo, nodeSnapshotRepo)`, each seeding/stubbing a real
      Output (or, for `AssistantServiceSpec`/`AssistantToolExecutorSpec`, reusing the
      already-existing `dataTypeBackedOutputRepo`/`outRepo` adapters those files built for task
      3.12's own rewire) rather than a DataType. **`PanelCapabilityServiceSpec` and
      `DataTypeRoutesSpec` were REWIRED, not deleted**, contrary to this task's original plan —
      by the time 3.11 landed, section 4 (which the plan assumed would already have deleted
      their subjects/routes) had NOT started, and leaving them both un-rewired would have left
      the tree non-compiling. `PanelCapabilityServiceSpec` was rewritten in full onto
      `OutputRepository`/`NodeSnapshotRepository` (real coverage preserved for 5.1/5.2/5.4/
      cross-tenant-404/nonexistent-404; the 5.3 "source-companion" case was RETIRED with an
      inline comment, not silently dropped — an Output has no source-companion concept at all,
      so that assertion tested a state that can no longer occur). `DataTypeRoutesSpec` needed
      only the same mechanical constructor-argument swap as the other 10 files (it has no test
      case actually exercising the `panel-capabilities` route). `PanelBindingSpec.scala` no
      longer exists (already retired in an earlier task-3.6 cycle, confirmed by a fresh
      `find` — nothing to update there); `PanelCapabilityProtocol.scala:7-8`'s doc comment is
      still accurate as written (the route it describes is still live pending §4.1) and needed
      no change. `DataTypeDataSourceAclSpec` additionally gained a `seedOwnedOutput` helper (a
      real `data_sources` → `pipelines` → `outputs` chain) since its two `panel-capabilities`
      route tests previously seeded only a bare `DataType` row with no corresponding Output.
- [x] 3.12 `WorkspaceContextService` (34 refs, `:5` imports `DataTypeService`): rewire every
      DataType/Metric reference to Outputs/pipelines/inferredSchema; do NOT touch `asNumeric`'s
      single-exit-filter structure or its `BigDecimal.setScale` rounding (HEL-631 caution).
      **Completed this cycle**: `dataTypeService: DataTypeService` constructor param replaced with
      `outputRepo: OutputRepository` (same positional slot); `assemble`'s `typesF` now sources from
      `outputRepo.findAllByOwner`; `toDataTypeEntry` rewritten to take an `Output` (schema adapted
      via a synthetic `DataField` per `SchemaField`, reusing every existing classification/stats
      function unchanged — `asNumeric`/`computeColumnStats`/`sanitizeSampleRows` untouched per the
      HEL-631 caution); sample rows/columnStats now read `NodeSnapshotRepository` (new
      `nodeSnapshotRepoOpt` trailing param) instead of `DataTypeRowRepository`; `buildPipeline`
      resolves a representative Output per pipeline for the legacy `outputDataTypeId`/
      `outputDataTypeName` wire fields. Domain `Output` gained a `schema: Vector[SchemaField] =
      Vector.empty` field (additive default) so `OutputRepository` can round-trip it.
      `OutputRepository` gained `findAllByOwner` (owner-scoped paged listing, mirrors
      `DataTypeRepository.findAll`) and `updateSchemaInternal` (test/internal use). Both
      `WorkspaceContextService`/`WorkspaceSearchService` degrade `outputRepo == null` to empty
      results rather than NPE (a real regression caught by `ApiTokenAuthSpec`'s
      dbContext-less `ApiRoutes` fixture — fixed, see files-modified.md). `WorkspaceContextServiceSpec`/
      `WorkspaceSearchServiceSpec` fixtures rewritten to seed real Outputs/`node_snapshots` instead
      of DataType rows; the "source-companion vs pipeline-output" distinction those specs used to
      assert no longer exists on the Output model (every Output is pipeline-derived by
      construction) — those specific assertions were retired, not silently dropped (see inline
      comments at each site). `output.tag` is NOT yet surfaced (domain `Output` has no `tag` field
      yet, though the DB column exists) — `WorkspaceContextDataType.tag` is `None` for every Output
      today, a documented, tracked gap, not a regression (see `toDataTypeEntry`'s own doc and the
      4.6b schema-validity test's inline comment).
- [x] 3.13 `AlertRuleRepository`: add `listEnabledByOutputInternal` (privileged internal read,
      mirrors today's `listEnabledByDataTypeInternal`) backing task 3.1's `evaluateForOutput`.
      Landed in cycle 9 (task 3.1's own commit); re-verified this cycle.
- [x] 3.14 `PanelRepository`/`PipelineRunService`: verify snapshot-writing call sites (not just
      the `:649` alert hook) are rewired to write `node_snapshots` keyed by node, not
      `data_type_rows` keyed by DataType. Verified this cycle by grepping every
      `overwriteRows`/`DataTypeRowRepository` call site in `backend/src/main/scala`:
      `PipelineRunService.scala:650` (the sole real writer) already dual-writes
      `node_snapshots` (cycle 9); `BoundPanelService.scala:322`'s clear-on-cleanup call
      belongs to a service task 4.1 deletes outright, not a live write path needing a
      `node_snapshots` counterpart. No `PanelRepository` write call site exists at all — it
      never wrote `data_type_rows` to begin with (`PanelRepository` only reads `panel`
      config, `PipelineRunService` is the sole row-materialization writer).
- [x] 3.15 `ApiRoutes.scala`: remove the `"data-type"` `ResourceType` registration (see
      `acl-resource-type-registry` delta) alongside the route deletions in §4.2. **Completed this
      cycle**, unblocked by 3.3 landing: confirmed via a fresh grep that no route or service
      anywhere ever called `accessChecker.requireAccess("data-type", ...)` or looked up
      `registry.lookup("data-type")` (the registration was dead weight, never actually consulted
      -- `DataTypeRoutes`'s own ACL checks go through direct repository ownership reads, not this
      registry, matching the `acl-resource-type-registry` delta's own note that Outputs/DataTypes
      were never part of registry-based ACL). Removed the one registration line in
      `ApiRoutes.scala` plus its 7 identical test-fixture mirrors across the patch-set spec files
      (`PatchSetApplyServiceSpec`/`PatchSetPreviewServiceSpec`/`PatchSetUndoServiceSpec`/
      `PatchSetRoutesSpec`/`PatchSetPreviewRoutesSpec`/`PatchSetUndoRoutesSpec`/
      `RefinementServiceSpec` -- each constructs its own local `ResourceTypeRegistry` mirroring
      `ApiRoutes`'s). The route-deletion half of this task (§4.2) is untouched, correctly deferred
      to section 4 (not yet started).

## 4. Delete retired repositories, services, protocols, routes, wiring

- [x] 4.1 Delete `DataTypeRepository`, `DataTypeRowRepository`, `DataTypeService`,
      `MetricRepository`, `MetricService`, `DataTypeProtocol`, `api/protocols/metrics/*`,
      `DataTypeRoutes`, `MetricRoutes`, `BoundPanelService`,
      `PanelServiceHelpers.withMaterializedMetric`, `PanelService` binding-resolution code.
      Completed this cycle: severed `PipelineRunService`'s legacy DataType schema/row writes
      (`upsertFieldsFromRows` deleted outright, `dataTypeRepo`/`dataTypeRowRepo` params removed;
      HEL-462 schema-drift baseline capture rewired onto `dataSourceRepo`'s own `inferredSchema`,
      mirroring task 4.3's pattern) — this was the last known live production consumer per the
      resume brief. Then deleted all 8 named files/classes plus their `ApiRoutes.scala`/
      `Main.scala` wiring, and mechanically removed the now-dead `dataTypeRepo`/`dataTypeRowRepo`/
      `metricRepo` constructor params from every downstream service/test fixture (`PipelineService`,
      `PipelineRepository`, `DashboardProposalService`, `DashboardContentsService`,
      `PatchSetApplyService`/`PatchSetPreviewService`/`PatchSetApplyContext`,
      `ProposalPanelSupport` — its non-`"output"`-kind DataType-binding branch removed outright,
      Text/Markdown panels no longer carry a binding at all) across ~40 test files. A handful of
      test fixtures that seeded a real `data_types` row purely to satisfy `pipelines.
      output_data_type_id`'s FK (still a live column pending task 2.10) were rewired onto raw SQL
      inserts against the same table, since `DataTypeRepository` no longer exists to do it for
      them.
- [x] 4.2 Remove wiring in `ApiRoutes.scala` and `Main.scala`. Completed this cycle alongside 4.1.
- [x] 4.3 Delete `DataSourceService.upsertSourceDataType` / `SourceService`'s second upsert /
      `CreateSourceEnvelope`; replace with `upsertInferredSchema`.
- [x] 4.4 `RlsPolicyGuardSpec`: add `outputs`/`node_snapshots`, remove `data_types`/
      `data_type_rows`/`metrics`. Completed this cycle; also corrected a stale `binary_refs`
      comment (re-keyed off `pipeline_id`, not the retired `data_type_id`, by task 2.8).
- [x] 4.5 Delete the backend specs for every deleted file above (`MetricRoutesSpec`,
      `PanelMetricBindingRoutesSpec`, `MetricRepositorySpec`, etc. — absorbs HEL-654). Completed
      this cycle: `DataTypeDataSourceAclSpec`, `DataTypeServiceSpec`, `DataTypeRoutesSpec`,
      `MetricRoutesSpec`, `DataTypeRepositorySpec`, `DataTypeRowRepositorySpec`,
      `MetricRepositorySpec`, `ComputedFieldsRoutesSpec` (computed-fields API surface, ticket item
      8), `MetricProtocolSpec`, `DataTypeServiceOverflowStructuredFieldNamesSpec` (its pure
      function already has its own inlined copy + coverage inside `WorkspaceContextService`) all
      deleted outright; several other spec files had individual now-dead test blocks/describe
      groups removed (the HEL-891 DataType-schema-union describe block in
      `PipelineRunServiceSpec`/`PipelineRunRoutesSpec`, the "DataType CRUD"/"DataType ownership
      enforcement" blocks in `ApiRoutesSpec`, the metric-deprecation-conflict tests in
      `PatchSetUndoServiceSpec`) rather than the whole file, where the file's remaining tests cover
      unrelated, still-live surface.
- [ ] 4.6 Split the oversized pipeline service files while open (HEL-689) —
      behavior-preserving; do not touch `WorkspaceContextService.asNumeric`'s structure/rounding.

## 5. Schemas + drift script + OpenSpec (pre-commit gate)

- [x] 5.1 Delete `schemas/metrics/`, `schemas/data-types/` (moving
      `data-type-assertion-status` → `schemas/outputs/output-assertion-status.schema.json`).
      `schemas/metrics/` was already deleted ahead of schedule (cycle 25, alongside `MetricProtocol`'s
      deletion). Landed this cycle: `schemas/data-types/data-type-assertion-status.schema.json`
      moved to `schemas/outputs/output-assertion-status.schema.json` via `git mv` (`$id` updated to
      match the new path; field shapes/description left untouched — the ticket instruction was
      "moving," not a content reshape, and the backing case class `AssertionStatusResponse` is now
      dead code with zero constructor call sites, out of this task's scope to clean up).
      `schemas/data-types/` directory removed (now empty).
- [x] 5.2 Reshape `schemas/panels/panel.schema.json` + `create-panel-request` + batch
      request/response to the placement model; delete `panel-capabilities-response`, `panel-query`.
      (`bound-panel-request/response` were already absent — confirmed via `ls`, no prior cycle
      left a note claiming credit for their deletion, so presumably retired earlier alongside
      `BoundPanelService`.) Landed this cycle: `panel.schema.json`'s `oneOf` collapsed from 9 arms
      (metric/chart/table/text/markdown/image/divider/collection/timeline) to the actual 5-kind
      set (output/text/markdown/image/divider) matching `Panel.Registry`; the five retired bound
      `$defs` (`MetricConfig`/`ChartConfig`/`TableConfig`/`CollectionConfig`/`TimelineConfig` +
      their nested aggregation/options defs) deleted, replaced by a single `OutputConfig` def
      (`{outputId: string}`, no `required`, matching `OutputPanelConfig.decode`'s tolerant
      empty-string-sentinel read path — the server still 400s an outputId-less output panel at
      create/update time via `validateConfig`, this is a wire-shape/decode-tolerance distinction,
      not a validation gap). Also found and fixed (real drift the enum-only check couldn't catch,
      since it doesn't inspect `$defs` shapes): `TextConfig`/`MarkdownConfig` still carried
      `dataTypeId`/`fieldMapping` properties — confirmed dead by reading `TextPanelConfig`/
      `MarkdownPanelConfig` (`case class TextPanelConfig(content: String)`, single field, no
      binding slot survives on either kind) — trimmed both defs to their actual single `content`
      property. `create-panel-request.schema.json`'s `allOf` mirrors the same 5-arm collapse.
      `create-panels-batch-request.schema.json`'s `type` enum (stale 9-value list, not covered by
      the drift script's `panelTypeSurfaces`) corrected to the same 5 values for internal
      consistency; `update-panels-batch-request.schema.json` already had the correct 5-value enum
      and no discriminated `config` shape to begin with (unchanged). **Field name stays `type`, not
      `kind`, on the wire** — task 5.4(c)'s "`properties.kind.enum`" plan below never actually
      landed: `PanelResponse`/`CreatePanelRequest` (`PanelProtocol.scala`) still carry a
      backtick-quoted `` `type` `` field (JSON key `"type"`), confirmed by reading the case classes
      and `panelResponseFormat`/`createPanelRequestFormat`'s `jsonFormatN` derivations — the
      "placement model" the ticket asks for is a *conceptual* rename (Panel's domain discriminator
      is called `kind` internally), not a wire-level one; the wire contract's `type` key never
      changed across 3.6's whole increment. Schemas correctly reflect this actual (not
      aspirational) wire shape — verified against `check-schema-drift.mjs`, which itself still
      checks `properties.type.enum`, not `.kind.enum` (see 5.4 below).
- [x] 5.3 Re-target `schemas/alerts/*` to `targetOutputId`. Already fully done (earlier cycle,
      alongside section 3.1's alert-rule rewire) — verified this cycle via grep: all four
      `schemas/alerts/*.schema.json` files reference only `targetOutputId`, zero remaining
      `targetDataTypeId`/`dataTypeId` references.
- [x] 5.4 Update `scripts/check-schema-drift.mjs` per design.md's Gate-Chain Implications
      Checklist. Verified this cycle (all already correct from earlier incremental cycles, no
      further edit needed):
      (a) the hard arm-count guard already reads `if (canonicalPanelTypes.length < 5)` with an
      updated error message referencing the 5-value end state (not the stale round-3 `< 8`).
      (b) `extractBetween`'s markers (`"def fromString(s: String)"` / `"def asString(t: PanelType)"`)
      still match `model.scala`'s actual method names — `PanelType`/`fromString`/`asString` were
      never renamed by task 3.6, so no marker update was needed.
      (c) the `panelTypeSurfaces` JSON pointers already read `["properties", "type", "enum"]` (not
      `.kind.enum`) across all three arm-count-checked schema files — correct, since the wire field
      never renamed to `kind` (see 5.2's note above); the round-3 plan's `kind` rename premise did
      not survive into the actual implementation, and the script correctly tracks reality, not the
      stale plan text.
      (d) `dashboard-proposal.schema.json`'s `$defs.ProposalPanel.properties.type.enum` is checked
      against `agentFacingPanelTypes` (4 values, `divider` excluded) — already correct, confirmed
      by re-running the drift script fresh (green).
      (e) the two `dataPanelTypeSurfaces` arrays (`helio-mcp/src/tools/proposalValidation.ts`
      `DATA_PANEL_TYPES`, `frontend/.../ProposalReview.tsx` `DATA_PANEL_TYPES`) are already
      `["output"]`, matching task 3.10's corrected `DataPanelKinds` retarget — confirmed by
      re-running the drift script fresh (green, "panel-type enums in sync ... 7 surfaces checked").
- [ ] 5.5 Delete/rewrite backend-facing OpenSpec capability specs — this ticket owns all 71
      capability deltas in this change's own `specs/` directory (round 3, full 115-file
      enumeration — see `openspec-coverage-checklist.md` for the authoritative per-capability
      classification: 65 of the 115 grep-matched files delta'd here, plus 6 further capability
      dirs not matched by the literal grep, 50 explicitly deferred to a named P-ticket, 1
      verified no-op); run `openspec archive` at delivery time to apply them, not before.
- [x] 5.6 `check:schemas`, `check-schema-drift.mjs`, `check:openspec`, `check:openspec:selftest`
      green. All four re-run fresh this cycle after 5.1-5.4's edits: `npm run check:schemas`
      ("schemas in sync with JsonProtocols (60 checked across 46 protocol files)", "panel-type
      enums in sync with backend canonical sets (7 surfaces checked)"); `npm run check:openspec`
      ("openspec/ is clean"); `npm run check:openspec:selftest` (17/17 passed). `sbt compile` also
      re-confirmed clean (no backend source touched this cycle, schemas-only diff).
- [x] 5.7 Mechanical constant/enum edit for the OTHER cross-surface arrays (NOT a feature
      rewrite — see design.md's Gate-Chain decision; `DataPanelKinds` itself is task 3.10's job,
      not this one, since it is a live predicate, not a passive list): update
      `helio-mcp/src/tools/proposal.ts:28`'s `PANEL_TYPES` to the new `agentFacingKinds` (new
      `kind` set minus `divider`: `output, text, markdown, image`), and
      `dashboard-proposal.schema.json`'s `$defs.ProposalPanel.properties.type.enum` to the same
      `agentFacingKinds` set — in the SAME commit as 5.4/3.6/3.10, so `check-schema-drift.mjs`'s
      cross-surface check and `check:helio-mcp-types`/frontend `typecheck` stay green. No other
      change to these files' logic/UX in this ticket.

## 6. Final verification

- [x] 6.1 `grep -rn` acceptance-criteria pattern over `backend/src` returns nothing but migration
      files (Spark's own `DataType` import excluded). **Cycle 30**: closed per the coordinator's
      ruling — `WorkspaceContextDataType` renamed to `WorkspaceContextOutput` (13 files); the
      `com\.helio\..*DataType` sub-pattern now returns zero hits. Two named wire-field-NAME
      exemptions (`outputDataTypeId`/`outputDataTypeName`, `leftDataTypeId`/`rightDataTypeId`)
      remain per cycle 29's design.md addendum; migration-verification test fixtures and
      historical-reference doc comments are the ticket's own established exception classes. See
      execution-progress.md cycle 30 for the full grep re-run.
- [x] 6.2 `grep -rn "DataType\|Metric" openspec/specs` returns nothing except the exact 50 files
      named in `openspec-coverage-checklist.md`'s deferred/no-op lists (9 → P1.4, 18 → P1.5,
      22 → P1.6, 1 no-op) — any other survivor is a real gap, not an acceptable residual.
      **Cycle 30**: re-verified fresh — 115 files still match, diffed against every name mentioned
      in the checklist, zero unlisted survivors. No changes needed; cycle 29's fix already closed
      this fully.
- [x] 6.3 `check:scala-quality` clean; no inline FQNs. **Cycle 30**: re-run fresh, exit 0, 130 soft
      warnings (same pre-existing file-size notices as every prior cycle).
- [x] 6.4 `sbt compile` and `sbt test` green. **Cycle 30**: re-run fresh, single-threaded
      (`set Test / parallelExecution := false`), not inherited — `Test/compile` clean, full suite
      3360/3360 passing, 225 suites, 0 aborted, 0 failed, exit 0.
- [ ] 6.5 File a follow-up obligation for each of the 49 deferred capabilities (not the 1 no-op)
      where the owning ticket's implementer will actually see it, not just in this change's
      docs: add a one-line pointer to `openspec-coverage-checklist.md`'s relevant section in a
      comment on HEL-907/HEL-908/HEL-909 (as appropriate) at PR-merge time, so a deferred spec
      isn't silently forgotten between now and that ticket's own Planning phase. **Cycle 30**: no
      Linear MCP tool available to this executor session — deferred to the orchestrator at
      Delivery/PR-merge time, consistent with this task's own "at PR-merge time" wording.
- [x] 6.6 State in the PR: computed-field count found (skip+log if zero), any binary_refs
      pointing at pipeline-output types (and how they were keyed), and link
      `openspec-coverage-checklist.md` as the authoritative record of the full 115-file
      OpenSpec surface. **Cycle 30**: PR-prep summary written in execution-progress.md, cross-
      referencing earlier cycles' findings.
