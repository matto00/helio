# Pipeline-output schema: union across rows, canonical types

## Why

A pipeline-output DataType's schema is derived from output row 0 alone. `PipelineRunService.upsertFieldsFromRows` takes `rows.headOption` and maps over that one row's keys, inferring each column's type from that one row's value. Rows in this engine are sparse `Map[String, Any]`, so any column absent from row 0 is dropped from the schema — and because `PanelCapabilityService.columnsOf` reads the stored `dt.fields` and never recomputes, the column becomes unbindable. The data is present and correct; only the derived schema is wrong, and nothing surfaces the loss.

Observed in production on v0.7.6: two pipelines over the same Sleeper projections source produced different column sets purely because of which row sorted first. `rec` was present on 166 of 200 rows of one pipeline's output and absent from its schema, so no panel could bind to receptions.

HEL-858 fixed this defect class for source inference, which now unions dotted paths across all sampled objects and widens types through an order-independent lattice. The pipeline-output path was never given the same treatment.

A second, independent defect lives on the same three lines. `inferFieldType` emits the string `"double"` for a fractional value, but `"double"` is not one of the seven canonical `DataFieldType` wire values — `asString` emits `"float"`. `PanelCapabilityService.wireType` round-trips through `DataFieldType.fromString` and `flatMap`s the `Option`, silently dropping anything unrecognised. So every pipeline-output column whose row-0 value is fractional is invisible to `get_panel_capabilities` today, independently of sparseness. That is a wider blast radius than the sparse-column bug.

## What Changes

- Derive the pipeline-output schema from **all** of the run's output rows rather than row 0, reusing the source path's inference *rules* — the union discipline and the order-independent widening lattice (`inferJsonType`, `widenJson`) — through a new shallow, top-level-key entry point on `SchemaInferenceEngine`.
- Deliberately do **not** reuse the flattening half of that engine. Nested objects do reach pipeline output (the image connector's `content` binary-ref map, HEL-216), and rows are persisted un-flattened, so flattening the schema would make it describe dotted keys the stored rows do not have. See design D2.
- Derive it from `jsRows`, the `Vector[JsObject]` already present at the call site and already persisted as the DataType's rows. Schema and rows then come from one value, so they cannot disagree by construction.
- Emit only canonical `DataFieldType` wire values, ending the `"double"` silent-drop. This falls out of using the shared engine, which produces `DataFieldType` rather than ad-hoc strings.
- Keep `nullable = true` pinned for every pipeline-output field, with a comment recording that this is deliberate and why.
- Delete `PipelineRunService.inferFieldType`, which has no remaining caller.

## Capabilities

- `pipeline-execution` — the schema a pipeline run derives for its output DataType.

## Non-Goals

- **Nullability is not unified with the source path.** The source engine's design D2 states that absence never contributes to nullability; only an explicit null does. The pipeline-output path currently hardcodes `nullable = true`, which is the *correct* answer for sparse data. Importing the source rule here would newly introduce HEL-868's bug onto a path that does not have it. Nullability stays pinned pending HEL-868, which should unify it in the correct direction.
- **`UnionStep`'s row-0 key derivation is not touched.** Filed as HEL-894 — a different layer (row backfill, not schema derivation) with no data loss.
- **No backfill migration.** Pipeline-output DataTypes are regenerated on every run; the compat assessment in design.md states what a user sees in the interim.
- **Persisted row shape is unchanged.** Rows continue to be stored exactly as `overwriteRows` stores them today; this change touches only the derived schema.
- **Column display names are unchanged.** See design D7.
