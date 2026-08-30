# Skeptic Report — design gate (round 2, skeptic-design-2.md)

## What I verified (with evidence)

### Round-1 change requests

- **CR1 (nested objects / flattening) — RESOLVED, and the load-bearing claim is TRUE.**
  `SchemaInferenceEngine.inferJsonType` (`domain/engine/SchemaInferenceEngine.scala:145-157`) has
  `case _ => (DataFieldType.StringType, false) // arrays, objects at leaf`. Today's
  `PipelineRunService.inferFieldType` (`services/pipelines/PipelineRunService.scala:741-747`) has
  `case _ => "string"`, and a `BinaryRef` value in `resultRows` is a `Map[String, Any]`, which falls
  to that catch-all. So `content` is `"string"` before and `StringType`→`"string"` after — identical,
  as D2 claims. The shallow entry point avoids `JsonFlattener.leaves`, so no dotted keys are invented
  and schema/row key agreement holds. Verified, not taken on assertion.
- **D1 (derive from `jsRows`) — sound.** `jsRows` is built at `PipelineRunService.scala:482-484` as a
  straight key-preserving `rowMap.map { case (k, v) => k -> PipelineRowJson.anyToJsValue(v) }`, so the
  key set of `jsRows` is exactly that of `resultRows`. Switching the schema source introduces no key drift.
- **CR2 (widening removes eligibility) — RESOLVED.** `widenJson` (:134-143) catch-all is `StringType`;
  `SlotEligibility.accepts` (`domain/panels/PanelBindingSpec.scala:18-25`) admits only Integer/Float
  for `Numeric`. D6 now states the corrected invariant, accepts it, and task 1.9 pins it with a
  non-weak assertion ("typed `string` AND not offered for a `Numeric` slot"). Task 3.4 no longer
  invites confirming the false claim.
- **CR3 (three-transition audit) — SPOT-CHECKED, rows hold.**
  - `PanelCapabilityService.wireType` (:76) `fromString(raw).map(asString)`, `columnsOf` `flatMap`s — row correct.
  - `SlotEligibility`: `Orderable` = Timestamp|Integer|Float, excludes String — so C genuinely gains
    `Orderable` and B genuinely loses it. Correct.
  - `BoundPanelService.validateBinding` (:103-134) evaluates `resolveSourceSchema` → the **source
    companion** DataType's fields, never the pipeline-output type. Row correct.
  - `WorkspaceContextService` (`services/workspace/`): `fieldCategory` = `fromString(...).map(category)`
    → `None` for `"double"`; `sanitizeSampleRows`/`computeColumnStats` filter on
    `fieldCategory(f).contains(Structured)`; `classifySemanticRole` falls to `"text"`;
    `typeBucket` → `"unknown:double"`. All four rows correct.
  - `PatchSetUndoConflictCheck.scala:146-149` — `live.fields == journaled.fields` confirmed; the 409
    hazard is real and correctly characterised as one-time/self-clearing.
  - Frontend: `PanelCreationModal.tsx:111` `NUMERIC_FIELD_TYPES = {integer,float}`;
    `TypeDetailPanel.tsx:167-173` dropdown has exactly the 7 canonical options, no `"double"`;
    `FilterConfig.tsx:37` / `AggregateConfig.tsx:37` `NUMERIC_TYPES` holds both spellings (paths now
    correct after round 1). Rows hold.
  - `DataFieldType.asString`/`fromString` (`domain/model/model.scala:596-617`) — exactly 7 values,
    `"double"` absent. Confirmed.
- **CR4 (`displayName`) — RESOLVED.** D7 decides raw-name-for-both, matching today's
  `DataField(name, name, ...)`; task 1.10 pins it.
- **CR5 (fixture could not fail) — RESOLVED as far as it goes.** Task 1.1 enumerates six shapes,
  1.2-1.11 map onto them, 1.12 requires each red be attributed to its specific defect. But the
  enumeration is still incomplete — see CR1 below.

### Order-independence of the new shallow entry point (task 2.1)

`widenJson` is commutative (`a==b` short-circuit; the two named pairs are symmetric; catch-all is
constant `StringType`) and associative over the reachable set (checked Int/Float/Bool and
Int/Float/Timestamp permutations by hand). With the globally-sorted merged key set task 2.1 requires,
the result is genuinely order-independent. AC "order-independent" is satisfiable as specified.

### Out-of-scope filings

- **HEL-896 confirmed real and out of scope.** `WorkspaceContextService.scala:388-389`:
  `fields.filter(f => fieldCategory(f) == FieldTypeCategory.Content)` compares
  `Option[FieldTypeCategory]` to a bare value — always false. Pre-existing, unrelated to this path,
  and unaffected by this change (this inference path never emits `string-body`/`binary-ref`; nested
  objects type as `string`). Not fixing it does not undermine any AC here.
- **HEL-895 confirmed out of scope.** `PipelineAnalyzeService`'s `"number"` is a symbolic
  per-step projection consumed by `BoundPanelService.projectSchema`, a different schema than the
  pipeline-output DataType `fields` this ticket writes. AC4 ("inference emits only canonical values")
  is scoped to this inference site and remains satisfiable without it.

## Verdict: REFUTE

One blocking gap, introduced by the round-1 revision itself: the shallow entry point's handling of
explicit JSON nulls is unspecified, and under the plain reading of task 2.1 it is a regression that
no planned test would catch.

## Change Requests

1. **Specify that an explicit `JsNull` must NOT participate in the type join — and say so in
   design.md, not only in the task.**
   Task 2.1 says the new entry point "folds each key's values through the existing `inferJsonType` +
   `widenJson`". Read literally, that is wrong: `inferJsonType(JsNull)` returns `StringType`
   (`SchemaInferenceEngine.scala:146`), so a single null cell anywhere in a column widens the whole
   column to `string`. `inferFromObjects` deliberately does not do this — it branches `case JsNull`
   first and contributes nullability only (:102-107, with the HEL-858 D3/D7 rationale in the comment).
   The shallow entry point must inherit that branch, and the design must state it as a decision,
   because it is a third named exception alongside D3 (nullability) and D7 (displayName).
   This is not hypothetical: explicit nulls are pervasive on this exact path.
   `PipelineRowJson.anyToJsValue:27` maps `case null => JsNull`; `LookupStep.scala:97` writes
   `c -> null` for every unmatched row; `CastStep.scala:66` returns `null` for an unconvertible value;
   `DateBucketStep.scala:121` uses `.orNull`. So a cast-to-number column with one unconvertible cell,
   or a lookup-brought numeric column with one unmatched row, would be typed `integer`/`double` today
   and `string` after this change — losing `Numeric` eligibility and therefore `metric.value` /
   `chart.yAxis`, on data the ticket exists to make *more* bindable. It would also contradict the
   spec delta's own scenario "a column with a non-integral value in a later row SHALL be `float`"
   whenever a null is also present.
   Required: (i) add the decision to design.md (JsNull contributes nothing to the type join here,
   mirroring HEL-858 D3; nullability is separately pinned `true` by D3 regardless); (ii) restate task
   2.1 so it cannot be implemented the naive way; (iii) add a spec scenario pinning it (a column that
   is numeric on some rows and explicitly null on others is still numeric).

2. **The fixture enumeration (task 1.1) is missing the null shape, so CR1's regression is untestable.**
   Shapes (a)-(f) contain no explicitly-null cell — (a) is *absence*, which is a different thing on
   this path and exercises a different code branch. Add shape (g): a column that is a number on some
   rows and an explicit JSON `null` on another, and a test asserting it is typed `integer`/`float`
   (not `string`) and is still offered for a `Numeric` slot. Without it, task 1.7's nullability test
   passes either way and nothing in 1.2-1.12 distinguishes the correct implementation from the
   regressive one. Per the standing "demand the red" requirement, note that this particular test is
   expected to be **green before and after** (it guards against a regression the change could
   introduce, not a defect being fixed) — task 1.12 should say so explicitly so the executor does not
   report it as a failed red or weaken it to force one.

## Non-blocking notes

- D5's `PanelCreationModal` cell for transition C says the x-axis auto-map "was dead code for pipeline
  outputs". Only the `firstFieldOfType(dataType, "timestamp")` lookup was dead; the
  `?? firstFieldOfType(dataType, "string")` fallback (`PanelCreationModal.tsx:132`) did fire. The real
  effect of C is a *change*: a date-like column now wins the x-axis default over whichever string
  column came first. Still an improvement, but the cell as worded is inaccurate.
- D5's `WorkspaceContextService` line references (`:361, :440-455, :474, :528, :534, :697-704`) are a
  few lines off in the current file but point at the right members; the substance checks out.
- Task 2.4a is well-aimed: the three comments naming `upsertFieldsFromRows`
  (`DataTypeRepository.scala:77,152`, `PipelineRepository.scala:204`) do describe its input shape.
