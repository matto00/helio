## Why

`JsonFlattener` cannot tell a struct from a map, so an object whose keys are *data* explodes into one column per key —
190 columns on a 12-row Sleeper source, 183 of them opaque player ids, and a column set that changes on every refresh.
The same defect produces a field declared as both a scalar and a flattened prefix (`drops` string AND `drops.8154`
integer), which nothing can bind against.

## What Changes

- Add a **cross-row map/struct classifier** to `JsonFlattener`, keyed on how stable an object's key set is across the
  sampled rows. Map-shaped paths become a single leaf carrying compact JSON text — exactly how `JsArray` is already
  handled — instead of N dotted columns.
- Thread the resulting `mapPaths` decision through **all three** `JsonFlattener` consumers so schema and rows continue
  to derive from one traversal (the HEL-599 invariant): source inference, row materialisation, and source preview.
- Resolve the scalar-and-prefix collision as a consequence: a map path is one leaf, so `drops` is one nullable column
  and no `drops.<id>` columns exist.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This corrects inference and materialisation to agree with the behaviour `JsonFlattener`'s own contract already
claims; no product-level requirement changes. `skip_specs: true` is set in `.openspec.yaml`.

## Non-goals

- **Remediating already-persisted schemas.** Ruled out of scope; filed as **HEL-1030**. The fix does not self-heal
  existing rows, and a prod data migration needs the owner's sign-off.
- **Fan-out capping / truncation reporting** (ticket option 2). Option 1 satisfies AC1 on its own; adding the
  truncation machinery would widen the diff into HEL-861/890/873 territory for no acceptance-criteria gain.
- **A dedicated map/JSON `DataFieldType`.** Reusing the existing array precedent (compact JSON text) avoids a change
  that would ripple through every `DataFieldType` consumer.
- HEL-1009, HEL-1012, HEL-1013, HEL-868, HEL-869, HEL-891 — adjacent and deliberately untouched.

## Impact

- `backend/src/main/scala/com/helio/domain/engine/JsonFlattener.scala` (classifier + leaf policy).
- `SchemaInferenceEngine.scala:113`, `PipelineRowJson.scala:100`, `SourceService.scala:421` — the three consumers.
- No frontend, no migration, no API shape change.
