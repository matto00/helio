## 1. Backend — inference engine

- [x] 1.1 In `SchemaInferenceEngine.inferFromObjects`, replace `PathAcc`'s `nullable: Boolean` with `presentNonNullCount: Int`, updating the case class and its doc comment to state the composed rule (design D1/D2).
- [x] 1.2 In the fold, increment `presentNonNullCount` only on the non-`JsNull` branch; leave the `JsNull` branch incrementing nothing and still contributing no type (preserves HEL-858 D3 unchanged).
- [x] 1.3 At projection, derive `nullable = acc.presentNonNullCount < objects.size` so absence and explicit null are one arithmetic rule, not two assignments.
- [x] 1.4 Rewrite the `PathAcc` / `inferFromObjects` comments: HEL-858's "design D2 -- absence never contributes" note is now false and must be replaced with the HEL-868 composed rule, citing this ticket. Do not leave the superseded claim standing.
- [x] 1.5 Confirm by reading that `inferShallowFromJsObjects`, `fromCsv`, `SchemaInferenceFacade`, and `JsonFlattener` need no edit; make no change to any of them beyond a clarifying comment on `fromCsv`'s `padTo` recording that CSV already honours absence (design D4).
- [x] 1.6 Verify no Flyway migration, no DB access, and no production file outside `SchemaInferenceEngine.scala` is touched (tests and this change's own `openspec/changes/` artifacts excepted); if either constraint appears to need breaking, stop and escalate.

## 2. Backend — investigation to record

- [x] 2.1 Confirm from the code that absence contributes nothing to `widenJson`, so inferred type carries no equivalent absence-blindness; capture the evidence for the PR body (design D5).
- [x] 2.2 Confirm and record that `SchemaInferenceFacade.toSchemaFields` drops `nullable`, so no persisted `data_sources.inferred_schema` value changes on re-inference (design D6, ticket AC 4).
- [x] 2.3 If HEL-893's cause (CSV declared-vs-materialized numeric types) becomes visible while working in this file, write the finding into `evidence/hel893-observation.md` and change nothing — HEL-893 has its own run.

## 3. Tests

- [x] 3.1 Invert the existing `"not mark field nullable when merely absent from some sampled objects"` test in `SchemaInferenceEngineSpec` to assert `nullable = true`, renaming it and its comment to describe the new rule.
- [x] 3.2 Add a test named for the ABSENT encoding: `[{"a":1,"b":2},{"a":3}]` yields `b` nullable and `a` non-nullable.
- [x] 3.3 Add a test named for the EXPLICIT-NULL encoding: a `JsNull` leaf in one object yields nullable (retains existing coverage under the new rule).
- [x] 3.4 Add a test named for the PRESENT-BUT-EMPTY encoding: `JsString("")` present in every object yields `nullable = false` and `StringType` — the encoding that must NOT be treated as null.
- [x] 3.5 Add one test that exercises all three encodings side by side and asserts the two `true`s and the one `false`, so the distinction is stated in the test itself, not just across three files.
- [x] 3.6 Add the 1-in-100 test: 100 objects, exactly one carrying `stats.rec`, asserting the produced `nullable` value is `true` — assert on the inferred field, never merely that inference completed.
- [x] 3.7 Add a real-fixture test over `hel858/sleeper-mixed-projections-slice.json` asserting `stats.rec` is nullable, and that a path present and non-null in all 15 elements is non-nullable (the false-positive guard on real data).
- [x] 3.8 Add an order-independence test: infer over a heterogeneous array and its reverse, asserting the full `(name, type, nullable)` triple sequence is identical.
- [x] 3.9 Add the type-independence test: a path integral in some objects and absent from the rest infers `IntegerType` with `nullable = true`, not `StringType`.
- [x] 3.10 Add the single-root-object test: every key of a lone `JsObject` with non-null values stays `nullable = false`.
- [x] 3.11 Add the CSV ragged-row regression test: three headers, one two-cell row, asserting the third column is nullable — pins the JSON/CSV agreement on absence.
- [x] 3.12 Update the WR-only fixture's pinned 63-field `(name, type, nullable)` expectation for any field whose nullability now flips, and update its comment block to attribute each flip to absence rather than to HEL-858's null rule.
- [x] 3.13 Add the second type-independence arm (skeptic design-1 note 3): a path that is `StringType` in some objects and absent from the rest infers `StringType` with `nullable = true`, so D5 is pinned on more than the integral arm.
- [x] 3.14 Capture the pre-fix RED output for tasks 3.6 and 3.7 explicitly (skeptic design-1 note 2) — they are new tests, so their red-before state is not automatic; record it in `evidence/red-before.md` alongside 3.1's inversion.
- [x] 3.15 Run the full backend suite (`sbt test`) and fix any other spec that asserted the old non-nullable-on-absence behaviour.

## 4. Verification

- [x] 4.1 Run `openspec validate infer-nullability-from-absence --type change` to zero exit.
- [x] 4.2 Run the backend gates the pre-commit hook enforces and confirm green before committing.
- [x] 4.3 Write `files-modified.md` declaring every path touched.
