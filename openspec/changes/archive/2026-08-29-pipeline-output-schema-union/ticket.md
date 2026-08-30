# HEL-891: Pipeline-output DataType schema is inferred from row 0, silently dropping sparse columns

## Description

The pipeline-output DataType's schema is derived from output row 0 alone. `PipelineRunService.upsertFieldsFromRows` (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:753-757`) does:

```scala
val firstRow = rows.headOption.getOrElse(Map.empty)
val fields = firstRow.keys.toVector.map { name =>
  DataField(name, name, inferFieldType(firstRow.get(name).orNull), nullable = true)
}
```

Both the key set and each column's type come from row 0. Rows are sparse maps, so a column absent from row 0 but present on later rows is dropped from the schema entirely. Since `PanelCapabilityService.columnsOf` reads the stored `dt.fields` and never recomputes from rows, the column becomes unbindable — no panel can use it, even though the data is there.

Observed in production on v0.7.6: two pipelines over the same Sleeper projections source produce different column sets purely because of which row sorted first. The Draft Board pipeline (row 0 = Josh Allen, a QB) has no `rec`/`rec_yd`/`rec_td`; the Rookie Board pipeline (row 0 = a rookie skill player) does. `rec` is present on 166 of 200 Draft Board rows — every WR, RB and TE.

HEL-858 fixed this class of defect for SOURCE inference. That path now unions dotted paths across all sampled objects and widens types via an order-independent lattice (`SchemaInferenceEngine.inferFromObjects` / `widenJson`). The pipeline-output path was never given the same treatment.

### Second defect on the same path (in scope, by decision)

`inferFieldType` (:741-747) emits the string `"double"` for a fractional value. `"double"` is NOT one of the 7 canonical `DataFieldType` wire values — `DataFieldType.asString` emits `"float"`. `PanelCapabilityService.wireType` calls `DataFieldType.fromString` and `flatMap`s the `Option`, so an unrecognised type string is silently dropped. Therefore **every pipeline-output column whose row-0 value is fractional is invisible to `get_panel_capabilities` today**, independently of sparseness. This is arguably the more severe of the two bugs.

`"double"` is a valid `CastStep` target but not a valid schema type; the two vocabularies genuinely diverge. The fix is to make inference emit a canonical value — NOT to add `"double"` to the canonical set, which has a wire contract behind it.

## Resolved decisions (escalated and answered before Planning — binding)

1. **Share keys and types; pin nullability.** Route key-union and type-widening through the existing shared engine (`SchemaInferenceEngine.inferSchemaFromRows`), but keep `nullable = true` pinned at the projection, with a comment stating why.

   Rationale, which inverts the ticket's original boundary note: this path *already* hardcodes `nullable = true`, so "a column absent from some rows is nullable" is already true here. `SchemaInferenceEngine`'s design D2 says "absence never contributes; only an explicit null does" — importing that rule wholesale would newly introduce HEL-868's bug onto a path that does not currently have it. That is a regression dressed as a consistency fix. Nullability stays deliberately un-shared pending HEL-868.

2. **The `"double"`/`float` defect is fixed in this ticket**, as a named second defect — its own red test (a fractional row-0 column absent from `get_panel_capabilities` before, present after) and its own line in the PR body. Not a silent rider.

3. **`UnionStep` is filed standalone, not folded in.**

## Acceptance criteria

- [ ] A pipeline-output DataType's schema is the union of keys across all of the run's output rows, not row 0's keys.
- [ ] A column present on *any* output row is bindable via `get_panel_capabilities`.
- [ ] Column types are widened as HEL-858 widens them for sources: a column with a non-integral value on any row is `float`, not `integer`. Order-independent — the schema must not depend on row ordering.
- [ ] Inference emits only canonical `DataFieldType` wire values. No pipeline-output column is dropped by `PanelCapabilityService.wireType` because of an unrecognised type string.
- [ ] Nullability remains `nullable = true` for every pipeline-output field, with a comment recording that this is deliberate and why (HEL-868). No field is newly asserted non-nullable.
- [ ] Red-first tests on a HETEROGENEOUS fixture where row 0 lacks a column later rows carry, and where a fractional value appears. Assert on the DataType's persisted `fields` AND on `PanelCapabilityService` output — not on a helper's return value. A uniform-row fixture cannot fail on this bug and does not count.
- [ ] Compat assessment stated explicitly: what a user sees between deploy and their next pipeline run, and whether any consumer persists or compares the type string in a way the `"double"` -> `"float"` transition breaks. Verify; do not assume self-healing.
- [ ] The enumeration of other derived-schema paths is recorded in the ticket, including which named paths are not independent inference sites but inherit from `PipelineRunService`.

## Enumeration of derived-schema paths (AC5) — established, for the design to confirm

| Path | Infers from | Status |
| -- | -- | -- |
| Source inference (`SchemaInferenceEngine.inferFromObjects`) | union across sampled rows | correct since HEL-858 |
| **Pipeline output (`PipelineRunService.upsertFieldsFromRows`)** | **row 0 only** | **this ticket** |
| `analyze_pipeline` per-step schema | symbolic; derived from declared step config, never reads rows | not an inference site |
| Patch-set preview projections | request payload / previously stored `fields` | inherits, not independent |
| CSV inference | folds across parsed rows | correct |
| `PanelCapabilityService` | reads stored `dt.fields` | inherits, not independent |
| `UnionStep.unionByName` (:97-98) | row 0 of each side | third in-class instance; filed as HEL-894 |
| `PipelineAnalyzeService.aggResultType` (:657, :485) | symbolic, but emits non-canonical `"number"` | different defect, same vocabulary class; filed as HEL-895 |

Two of the four paths the ticket names are therefore not independent inference sites at all — they inherit from `PipelineRunService`, so fixing it fixes them.

## Verification standard

Verify by measurement, not attestation. Demand the red: show each test failing before the fix. A weak assertion is the same as no test. Note that the jest gate is vacuous inside a delivery worktree (HEL-880) — a green root `npm test` there is not evidence; backend work must be proven with `sbt test`.
