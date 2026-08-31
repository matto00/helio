## Why

Data Types and Metrics duplicate the pipeline output they always were (1:1 by
construction), fragmenting the mental model into six concepts and blocking the
Outputs remodel (HEL-903). This ticket lands the data model + migration and
deletes every DataType/Metric consumer so the backend keeps compiling.

## What Changes

- **BREAKING**: add `outputs`, `node_snapshots`; add `pipeline_steps.parent_step_id`
  (tree-ordered reads, splice-on-delete); add `panels.kind`/`output_id`, drop
  the bound-panel columns; add `data_sources.inferred_schema`; re-key
  `alert_rules`/`alert_events`/`binary_refs` off Outputs; migrate computed
  fields to `compute` steps; drop the patch-set journal's `dataType`/`metric`
  target kinds.
- **BREAKING**: drop `metrics`, `data_types`, `data_type_rows`,
  `pipelines.output_data_type_id` after data migration.
- **BREAKING**: delete every DataType/Metric repository, service, protocol,
  route, and `Main.scala` wiring; rewire alerts, search, teardown, dashboard
  contents, assistant executor, patch sets, `DemoData`.
- Delete/reshape every schema (`schemas/metrics`, `schemas/data-types`,
  `schemas/panels/*`, `schemas/alerts/*`) and update
  `scripts/check-schema-drift.mjs` so the pre-commit gate stays green.
- Split the oversized pipeline service files while open (HEL-689).

## Capabilities

**Round 3 note:** this section lists representative examples only. The
authoritative, exhaustive, per-capability classification of all 115
DataType/Metric-bearing OpenSpec capabilities (71 delta'd in this change, 50
deferred to a named P-ticket, 1 verified no-op — a complete, non-overlapping
partition) is `openspec-coverage-checklist.md` in this change directory.
`tasks.md` 6.2's acceptance-criteria grep is checked against that file, not
against this section.

### New Capabilities
- `outputs-model`: `outputs` table, kinds, sharing-aware RLS, repository.
- `node-snapshot-persistence`: replace-per-run snapshots keyed by pipeline+node.
- `pipeline-step-tree`: `parent_step_id`, trunk/tail reads, splice-on-delete.
- `output-panel-placement`: Panel as a placement (`kind`, `output_id`).
- `data-source-persistence`: adds `inferredSchema` (ADDED requirement — the capability itself
  already exists; only a new field is added, hence listed here rather than under Modified).

### Modified Capabilities
- `alert-rule-persistence`, `alert-rule-crud-api`, `alert-event-persistence`,
  `alert-event-state-machine`: `target_data_type_id`/`targetDataTypeId` →
  `target_output_id`/`targetOutputId` throughout.
- `alert-evaluation-engine`: evaluate per Output/node snapshot.
- `backend-persistence`: panels store an Output placement, not a DataType binding.
- `rls-owner-tables`, `rls-policy-guard`: `data_types`/`data_type_rows`/`metrics`
  drop out of the owner-only and guard-spec allowlists; `outputs`/`node_snapshots`
  join the sharing-aware set.
- `acl-resource-type-registry`: `"data-type"` resource type removed (Outputs
  authorize via their owning pipeline, no independent resolver).
- `pipeline-create-api`: `POST /api/pipelines` stops requiring/returning
  `outputDataTypeName`; no DataType is minted.
- `workspace-resource-search`, `workspace-tag-teardown`, `dashboard-contents-replace`:
  DataType/Metric/companion-type branches retarget to Outputs.
- `patch-set-contract`: `dataType`/`metric` target kinds removed.
- `panel-batch-create`, `panel-batch-update`: batch item binding/config-patch
  columns retarget from DataType/aggregation to Output placement fields.
- `external-run-hooks`: "prior DataType snapshot" → "node snapshot(s)".
- `output-panel-placement` (new capability, see above) also absorbs
  `panel-type-field`'s surviving content-panel fields (content, imageUrl,
  imageFit) as an added requirement.

### Removed Capabilities (deleted outright, decision 11 — no deprecation)
`datatype-crud-api`, `data-type-persistence`, `data-type-acl`,
`datatype-row-snapshot`, `metric-crud-api`, `metric-definition-persistence`,
`metric-usage-governance`, `bound-panel-composition`, `panel-datatype-binding`,
`type-registry-content-fields`, `type-registry-provenance`,
`panel-capability-introspection`, `panel-viz-aggregation`, `panel-type-field`
(superseded by `output-panel-placement`'s `kind`/content-field requirements).

## Impact

~78 backend files (routes, services, repositories, `Main.scala`, `DemoData`,
specs); one Flyway migration (V94); `schemas/`, `check-schema-drift.mjs`,
`openspec/specs/`. Frontend and MCP untouched here (P1.3/P1.4/P1.5) and will
not compile against the new API shape until those land — expected per
decision 17; this ticket is backend-only.
