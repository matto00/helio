# Design — pipeline-output schema union

## Context

`PipelineRunService.upsertFieldsFromRows` (`backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:749-766`) is the single place a pipeline-output DataType's `fields` are written. It is called once, from `onUnblockedRunSuccess` (:622), on the success path of a run.

```scala
val firstRow = rows.headOption.getOrElse(Map.empty)
val fields = firstRow.keys.toVector.map { name =>
  DataField(name, name, inferFieldType(firstRow.get(name).orNull), nullable = true)
}
```

Three properties are derived here — the key set, each column's type, and nullability — and the first two are derived from row 0 alone.

## Decisions

### D1 — Derive the schema from `jsRows`, not `resultRows`

`onUnblockedRunSuccess` already holds two representations of the same output rows: `resultRows: Seq[Map[String, Any]]` (engine-native, `jsValueToAny`-converted) and `jsRows: Vector[JsObject]` (JSON). `jsRows` is what `dataTypeRowRepo.overwriteRows` persists as the DataType's rows (:625).

Derive the schema from `jsRows`. Two reasons, in order of weight:

1. **Schema and data become consistent by construction.** They are derived from the same value in the same method, so the schema cannot describe rows other than the ones stored. Deriving from `resultRows` would leave two parallel derivations that could drift, which is the general shape of the bug being fixed.
2. It is the input type `SchemaInferenceEngine.inferSchemaFromRows` already accepts, so no conversion or second inference vocabulary is needed.

The alternative — union over `resultRows` with a locally-written fold — was rejected: it would be a second implementation of a rule that already exists, which is precisely why this defect survived HEL-858.

### D2 — Reuse the shared inference *rules*, but not its flattening

Route through the same widening lattice and union discipline the source path uses (`SchemaInferenceEngine`), via a new **shallow** entry point that unions **top-level** keys of each `JsObject` and folds each key's values through the existing `inferJsonType` and `widenJson`.

This deliberately does **not** reuse `inferSchemaFromRows`/`inferFromObjects`, because those flatten each object through `JsonFlattener.leaves` first.

**Why flattening is wrong for this path (design-gate round 1, CR1 — an earlier version of this document asserted post-pipeline rows are flat; that was false).** Nested objects demonstrably reach pipeline output today. `PipelineRowJson.anyToJsValue` (`domain/engine/PipelineRowJson.scala:47`) has an explicit `case m: Map[String, Any] => JsObject(...)`, added by HEL-216 precisely because the image connector's `content` field is a nested `BinaryRef` map (`storageKey`/`mimeType`/`filename`/`sizeBytes`). `PipelineRunService.extractBinaryRefs` (:713-731) exists solely to harvest those nested maps from `resultRows` on this very call path.

If inference flattened, the schema would carry `content.storageKey`, `content.mimeType`, `content.filename`, `content.sizeBytes` while `overwriteRows` persists the row key `content` un-flattened. That is schema/row disagreement — the exact defect class this ticket exists to remove, reintroduced one level down — plus a column vanishing from the capability report, plus a silent break of `WorkspaceContextService`, which looks up `row.fields.get(field.name)`.

**What the shallow rule yields for a nested value.** `inferJsonType`'s catch-all (`SchemaInferenceEngine.scala:157`) already returns `StringType` for "arrays, objects at leaf". Today's `inferFieldType` catch-all returns `"string"` for the same value. So `content` is typed `string` before and after — behaviour preserved exactly, no column lost, no dotted key invented.

Flattening the persisted rows instead was rejected: it would change `data_type_rows.data` shape, break the `content` read path and the `binary_refs` index, and is far outside this ticket.

Sharing is therefore explicit about what is and is not shared: **the key-union discipline and the type lattice are shared; the flattening policy is not**, because flattening belongs to the source path, whose raw API responses are flattened into dotted columns before storage (HEL-599). Pipeline-output rows are already-projected columns stored un-flattened. This is the same shape of stated exception as D3's nullability pin.

### D2a — The image loader is the sole producer of a nested row value

D2's no-flattening decision only matters because a nested value can actually reach `resultRows`. Established by enumeration (design-gate round 4):

- **Every JSON-bearing source flattens nested objects at ingest.** `PipelineRowJson.jsRowToRow` (`:95`) is `case obj: JsObject => JsonFlattener.leaves(obj).map { ... }`, and `JsonFlattener.walk` recurses into every nested `JsObject`. So a REST, SQL or static source row can never deliver a nested `Map[String, Any]` to the engine — it arrives already flattened to dotted keys.
- **`InProcessPipelineEngine.loadImageRowFromBytes` (`:318-333`) is the only write site** that constructs a nested map (`"content" -> Map("storageKey" -> ..., "mimeType" -> ..., "filename" -> ..., "sizeBytes" -> ...)`). Verified by grepping `"storageKey"` across `backend/src/main/scala`: the only other two hits are the *read* sites in `PipelineRunService.extractBinaryRefs`/`isBinaryRefShape`. `ComputeStep` routes through `jsValueToAny`, which `compactPrint`s an object into a string; `LookupStep` copies values from the other side's already-flattened rows.

Two consequences:

1. **D2 remains correct and necessary.** The nested `content` value is real, reaches `overwriteRows` un-flattened, and would be split into four dotted schema fields that match no stored row key if inference flattened. That the producer is narrow does not make the disagreement less real — it makes it *rarer and therefore easier to ship unnoticed*.
2. **The test plan needs two fixtures, not one.** That loader returns a single row of fixed shape from an `image` source requiring a real stored file. It cannot be sparse, cannot carry an all-null column, and cannot be combined with a heterogeneous JSON fixture by any step in scope. Task 1.1 splits accordingly. This is a constructibility constraint, not a stylistic preference.

### D3 — Nullability stays pinned at `true`, deliberately un-shared

`inferSchemaFromRows` sets `nullable` per design D2 of HEL-858: absence never contributes, only an explicit `JsNull` does. That rule is wrong for sparse data and is the subject of HEL-868.

The pipeline-output path currently hardcodes `nullable = true`, which is the correct answer for this data: rows are sparse maps, and any column may be absent. Adopting the engine's nullability would therefore be a **regression** — a column present on 166 of 200 rows would be advertised non-nullable, which is exactly HEL-868's defect, newly introduced on a path that does not have it today.

So: take the engine's **name and type**, discard its **nullable**, and pin `true` with a comment stating why and naming HEL-868. This is a stated exception with a reason, not two coexisting rules by accident. When HEL-868 lands absence-implies-nullable on the source path, this pin should be revisited and most likely deleted — the comment says so.

This satisfies the ticket's nullability criterion by preservation rather than by change.

### D4 — `inferFieldType` is deleted, not repaired

`inferFieldType` (:741-747) emits `"double"` for fractional values. `"double"` is not one of the seven canonical `DataFieldType` wire values; `DataFieldType.asString` emits `"float"`. `PanelCapabilityService.wireType` (:76) round-trips through `DataFieldType.fromString` and the caller `flatMap`s, so an unrecognised string is silently dropped from the capability report. Every pipeline-output column whose row-0 value was fractional is therefore unbindable today.

The fix is not to add `"double"` to the canonical set. That set is a wire contract with seven values, consumed by the frontend, the MCP surface and the assistant. `"double"` is a valid `CastStep` *target* type — a separate vocabulary that legitimately differs — and conflating the two would widen the schema contract to accommodate a bug.

Once D2 is in place, `inferFieldType` has no caller. It is deleted rather than left dead, matching the precedent HEL-858 set when it deleted `mergeObjects`.

### D5 — Compat: three transitions, audited

Pipeline-output DataType `fields` are fully overwritten on every successful run (`updateInternal(existing.copy(fields = fields, ...))`), so there is no accumulation and **no backfill migration is needed**. A stored value is corrected the next time its pipeline runs.

**What a user sees between deploy and their next run:** exactly what they see today. Stored schemas are untouched by the deploy itself — a DataType whose last run predates the deploy keeps its row-0 field list, sparse columns still missing, fractional columns still `"double"` and still unbindable. Nothing gets worse; nothing improves until the pipeline runs again. Scheduled pipelines self-correct on their next tick; manually-run pipelines need one manual run. Worth stating in the PR body so it is not mistaken for the fix not working.

An earlier version of this section audited only one transition. That was incomplete (design-gate round 1, CR3). The change produces **three**:

- **(A) `"double"` → `"float"`** — fractional numeric columns.
- **(B) `"integer"` → `"string"`** — a column numeric in row 0 holding a boolean or non-numeric string later; `widenJson`'s catch-all.
- **(C) `"string"` → `"timestamp"`** — `inferJsonType` calls `isTimestamp` for ISO-date / `MM/dd/yyyy` strings. `inferFieldType` never emitted `timestamp`, so **no pipeline-output column has ever had this type before**.

| Consumer | A (double→float) | B (integer→string) | C (string→timestamp) |
| -- | -- | -- | -- |
| `PanelCapabilityService.wireType` (`services/panels/PanelCapabilityService.scala:76`) | **fixed** — column was dropped entirely | visible, loses `Numeric`/`Orderable` eligibility | **improved** — gains `Orderable` |
| `PanelBindingSpec.SlotEligibility.accepts` (`domain/panels/PanelBindingSpec.scala:18-21`, filter at `:149`) | **fixed** — was in no eligible list | eligibility lost (see D6) | gains timeline `time` slot |
| `BoundPanelService.validateBinding` (`services/panels/BoundPanelService.scala:103-135`) | n/a — reads the **source companion** schema, not this one | n/a — same | n/a — same |
| `WorkspaceContextService` sampling/stats (`:361`, `:474`, `:528`, `:534`) | **fixed** — fractional columns were excluded from sample rows *and* column stats | quality regression: `measure` → `dimension`/`text` | **improved** — `temporal` role |
| `WorkspaceContextService.classifySemanticRole` (`:440-455`) / `typeBucket` (`:697-704`) | **fixed** — was `text` / `unknown:double` | numeric bucket → string bucket | **improved** |
| `helio-mcp/src/context.ts` (`:165`, `:339`, `:478`, `:536`) — independent re-implementation | **fixed** — never knew `"double"` | same quality regression | **improved** |
| `helio-mcp/src/tools/updateSchemas.ts:25,35` | `z.string().min(1)`, no enum — cannot reject | same | same |
| `frontend/.../panels/ui/PanelCreationModal.tsx:111,132` | **fixed** — `NUMERIC_FIELD_TYPES` is `{integer,float}`, so double was never auto-mapped | stops auto-mapping (correct) | **changed, an improvement** — `firstFieldOfType(dataType,"timestamp")` was unreachable for pipeline outputs, but the `?? firstFieldOfType(dataType,"string")` fallback did fire; a date-like column now wins the x-axis default over whichever string column came first |
| `frontend/.../dataTypes/ui/TypeDetailPanel.tsx:167-173`, `sources/ui/InferredFieldsTable.tsx:52-58` | **fixed** — dropdowns have no `"double"` option, so the field rendered as an empty placeholder | safe, valid option | safe, valid option |
| `frontend/.../pipelines/ui/stepConfigs/FilterConfig.tsx:37`, `AggregateConfig.tsx:37` | safe — `NUMERIC_TYPES` holds both spellings | safe — falls back to a text input | safe |
| `schemas/**` JSON Schema | no enum; `"type": "string"` throughout | safe | safe |
| Alerting (`services/alerts/AlertEvaluationService.scala:38-46`) | not a consumer — matches on runtime value classes, never the type string | same | same |

No API rejects any of the three; nothing 500s; no stored panel stops rendering (rendering is driven by row values — no file under `domain/steps/` references `DataType.fields`).

**Two consequences worth calling out rather than burying:**

1. **B is a real, accepted loss** — the only transition that takes anything away. See D6.
2. **Patch-set undo may 409 in a burst.** `PatchSetApplyRollback.scala:295` journals a DataType's `fields` into `priorState`, and `PatchSetUndoConflictCheck.scala:146-149` compares `live.fields == journaled.fields`, reporting "changed since the patch set was applied" on any difference. A pending undo of a `dataType` edit will therefore fail after that pipeline's next run. This already happens today whenever a run rewrites a type; the change triggers it for more DataTypes at once. It is one-time and self-clearing, and no data is lost — the undo is refused, not corrupted. Not worth blocking on, worth stating in the PR body.

**Two pre-existing defects found during this audit, neither caused by this change, both filed rather than fixed here:** HEL-895 (`PipelineAnalyzeService` emits non-canonical `"number"` for `sum`/`avg`/`running_sum` — the same vocabulary defect as `"double"`, but on a path that *hard-rejects* the bind rather than degrading a menu) and HEL-896 (`WorkspaceContextService:389` compares an `Option` to a bare value, so content fields are never excluded).

### D6 — What is additive, and what is not (corrected)

An earlier version of this document claimed the change "cannot remove a column from the capability report" and that an already-numeric column stays eligible. **The first half is true; the second is false** (design-gate round 1, CR2).

The real invariant, stated precisely:

- **The key set is strictly additive.** Union-across-rows can only add columns relative to row 0's keys. No column disappears from `get_panel_capabilities`. (D2 preserves this for nested values too.)
- **A column's inferred type may widen, and widening can remove *slot eligibility*.** `widenJson` has a catch-all `case _ => StringType`. A column holding a number on row 0 and a boolean or non-numeric string (`"N/A"`, `"-"`) on any later row infers `integer` today and `string` after. `SlotEligibility.accepts` (`domain/panels/PanelBindingSpec.scala:18-21`) admits only `IntegerType`/`FloatType` for `Numeric`, so that column loses `metric.value` / `chart.yAxis` eligibility; if it was the DataType's only numeric column, that panel kind flips `bindable: true` → `false` in the report.

**This is accepted, and it is the correct answer.** A column containing `"N/A"` is not numeric, and advertising it as numeric is the same class of lie as advertising a sparse column non-nullable — the thing this epic is about. The report becomes more honest, and honest can mean narrower. Exactly the messy heterogeneous data the ticket concerns, so it is not hypothetical and a test pins it.

**No existing panel binding breaks.** Verified: `BoundPanelService.validateBinding` (:103-117) evaluates against the **source companion** DataType's fields projected through the pipeline steps (`resolveSourceSchema` :119-134), not against the pipeline-output DataType — and it runs only when a bound panel is created. Stored bindings are never re-validated against the output DataType's fields, so a type change there cannot invalidate a panel that already exists. The capability report is advisory by its own contract ("advisory, not a bind-time-enforced guarantee"), and only the advisory offer menu narrows.

### D7 — `displayName` stays equal to the raw column name

Today `upsertFieldsFromRows` writes `DataField(name, name, ...)`: the display name *is* the raw column name. `SchemaInferenceEngine`'s `InferredField` instead carries `displayName(path)`, which title-cases and splits (`rec_yd` → `"Rec Yd"`).

Adopting the engine's display name would silently relabel every column of every pipeline-output DataType on its next run — a visible UI change for every existing user, unrelated to this defect, and not something the ticket asks for. It is also not obviously an improvement: pipeline output column names are chosen by the user in a `rename`/`select` step, so echoing them verbatim respects an explicit choice, whereas the source path's names come from a third-party API and benefit from prettification.

Decision: **write the raw column name for both `name` and `displayName`**, preserving current behaviour exactly. The engine's `displayName` is discarded along with its `nullable`. A test asserts this, so a later refactor cannot adopt it by accident.

### D8 — An explicit `JsNull` contributes nothing to the type join

The shallow entry point must branch on `JsNull` **before** consulting `inferJsonType`, and a null must never participate in the widening join. This is the third named exception alongside D3 (nullability) and D7 (display name), and it is stated here because the round-1 revision introduced the gap: "fold each key's values through `inferJsonType` + `widenJson`", read literally, is a regression.

**Why the naive reading breaks.** `inferJsonType(JsNull)` returns `StringType` (`SchemaInferenceEngine.scala:146`). Folding that through `widenJson` against a numeric accumulator hits the catch-all `case _ => StringType`, so **one null cell anywhere in a column would widen the entire column to `string`** — costing it `Numeric` eligibility and therefore `metric.value` / `chart.yAxis`.

**This is not hypothetical; nulls are pervasive on this exact path:**

- `PipelineRowJson.anyToJsValue:27` — `case null => JsNull`.
- `LookupStep.scala:97` — `columns.map(c => c -> firstMatch.getOrElse(c, null))`, so every unmatched row gets nulls for the brought columns.
- `CastStep.scala:66` — `if (v == null) return null`, and an unconvertible value casts to `null`.
- `DateBucketStep.scala:121` — `.orNull` for an unparseable date.

So a cast-to-number column with a single unconvertible cell, or a lookup-brought numeric column with a single unmatched row, would be `integer` today and `string` after — on data this ticket exists to make more bindable, not less. It would also contradict this change's own spec scenario ("a column with a non-integral value in a later row SHALL be `float`") whenever a null is also present.

**Decision:** mirror `inferFromObjects`' existing `case JsNull` branch (`SchemaInferenceEngine.scala:102-107`) exactly — a null contributes nothing to the type. It does not contribute nullability either, because D3 already pins `nullable = true` unconditionally on this path; the branch exists purely to keep the null out of the join.

A column that is entirely null on every row has no non-null value to infer from and falls back to `StringType`, matching `inferFromObjects`' own fallback and today's `inferFieldType(null) => "string"`.

**Blast radius, for the record.** Today a null only affects the type when it lands in row 0. Union-across-rows means *any* null in the column would poison it — so the naive implementation would be strictly worse than the bug being fixed, not merely imperfect. That is why D8 is a stated decision with a pinned test rather than an implementation note.

## Risks

- **A column is added that a user did not previously see.** Intended — that is the fix. It is additive: `get_panel_capabilities` gains entries, never loses them.
- **Cost.** Inference now walks all output rows instead of one, bounded by `InProcessPipelineEngine.MaxRunRows`. The rows are already fully materialised in memory and are being written to the database on the same code path, so a single additional in-memory fold is proportionate to work already being done.

## Gate-Chain Implications Checklist

Not applicable — this change touches no file under `.husky/**` and no script invoked by a pre-commit hook. It is confined to backend Scala under `com/helio/services/pipelines` and its tests.
