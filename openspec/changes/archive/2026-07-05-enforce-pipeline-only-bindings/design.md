# Design — enforce-pipeline-only-bindings

## Context

Two DataType populations exist in `data_types` (V4 + V22 era):

- **Companion types** — created by `DataSourceService.createStatic/createCsv` and
  `SourceService.createSql/createRest` with `sourceId = Some(source.id)`. Load-bearing for:
  pipeline analyze (`PipelineService.analyze` → `dataTypeRepo.findBySourceId`), source preview
  computed fields (`SourceService.previewSql/previewRest`), refresh upserts
  (`DataSourceService.upsertSourceDataType`, `SourceService.upsertDataType`), and the frontend
  `SourceDetailPanel` schema display + `DataSourceList.isBoundToPanel`.
- **Pipeline outputs** — created by `PipelineRepository.create` with `sourceId = None`; rows
  materialized into `data_type_rows` by runs.

Panels bind via `panels.type_id` (V5). `useLegacyBoundPanel` flags `sourceId != null` bindings as
"legacy", which misfires for every source-registration-flow binding.

## Decisions

### D1 — Convert bound companion types in place; insert a replacement companion (V41)

For each companion type with ≥1 bound panel: create a zero-step pass-through pipeline
(`source_data_source_id` = old `source_id`, `output_data_type_id` = the bound type), clear the
type's `source_id`, and insert a fresh companion type (new UUID, same name/fields/computed_fields,
`version = 1`, same `owner_id`). Rationale: panels keep their `type_id` and their existing
`data_type_rows` snapshot — zero rendering disruption — while every source retains exactly one
companion record so analyze/refresh/schema display are unaffected. The alternative (re-bind panels
to a new output type) would blank panels until a first pipeline run.

- Pipeline name: `<type name> (migrated)`; `last_run_*` NULL (never run; snapshot predates it).
- `gen_random_uuid()::text` for ids (PG13+; dev 18 / CI 14 / prod 16 all fine).
- Companion types with no bound panels are left untouched.

### D2 — Server-side guard at the panel service seam

`POST /api/panels` / `PATCH /api/panels/:id` resolve the incoming `dataTypeId` and reject with 400
("Panels can only bind to pipeline-output data types") when the type has `sourceId` defined.
Client-side filtering alone would leave the API able to recreate the inconsistency.

### D3 — Companion types stay in `GET /api/types`; frontend filters

`SourceDetailPanel` and `DataSourceList` resolve companion types from `state.dataTypes.items` by
`sourceId`. Hiding them at the API would break that; instead a shared selector
(`selectPipelineOutputDataTypes`, filter `sourceId === null`) feeds every user-facing type list:
BindingEditor, panel-creation DataType step (replacing its pipeline-output-id derivation — the two
filters are equivalent post-V41), and the Type Registry sidebar/browser.

### D4 — Retire the legacy warning wholesale

`PanelLegacyWarning` (+CSS), `useLegacyBoundPanel` (+tests), the `PanelCard` mount, and the
`panel-legacy-binding-warning` spec are deleted. Post-V41 + D2 the flagged state is unreachable.

### D5 — Pipeline detail shows its one bound source, read-only

`SourceSelectorBar`/`SourceChip` (mock rows, dead "+ Connect source", no-op active toggle) imply
multi-source composition that contradicts the one-input model. Replaced with a read-only bound
source display (name + kind). Edit-source/lock affordances remain HEL-260's scope.

### D6 — Source delete warning keys off pipelines

Post-V41 companion types are never panel-bound, so `DataSourceList.isBoundToPanel` is permanently
false. The delete warning now checks pipelines with `sourceDataSourceId === source.id` (pipelines
fetched on the Sources page via the existing pipelines slice).

## Planner Notes

- Demo seed data: if `DemoData` binds panels to companion types, it must seed a pass-through
  pipeline instead, or the guard (D2) and dev UX contradict the seed.
- `upsertSourceDataType`/`upsertDataType` duplication and the `/api/sources` vs `/api/data-sources`
  split are explicitly out of scope (see proposal non-goals).
- Spec drift fixed alongside (not behavior): `datatype-crud-api` documents `/api/types` (actual
  route) not `/api/data-types`; `pipeline-analyze-api` duplicate requirement blocks deduped.
