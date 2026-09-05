# Files modified — HEL-868

- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` — `PathAcc.nullable: Boolean` replaced with `presentNonNullCount: Int`; `inferFromObjects` now derives `nullable = presentNonNullCount < objects.size` at projection time, so absence and explicit `JsNull` compose into one rule (design D1/D2). Added a clarifying comment on `fromCsv`'s `padTo` recording that CSV already honours absence (design D4); no CSV code change.
- `backend/src/test/scala/com/helio/domain/engine/SchemaInferenceEngineSpec.scala` — inverted the old "absence never contributes" test to assert `nullable = true` (ABSENT encoding); added tests for the PRESENT-BUT-EMPTY encoding, all-three-encodings-side-by-side, the 1-in-100 case, both type-independence arms (Integer and String), the single-root-object non-nullable case, the real `hel858/sleeper-mixed-projections-slice.json` fixture (`stats.rec` nullable / `player_id` non-nullable), an order-independence test over a heterogeneous array, and a CSV ragged-row regression test pinning the JSON/CSV agreement on absence.
- `openspec/changes/infer-nullability-from-absence/tasks.md` — all tasks marked complete.
- `openspec/changes/infer-nullability-from-absence/evidence/red-before.md` — pre-fix RED evidence: stashed the production change, re-ran the spec, captured the 6 failing tests (the inverted absence test, the two type-independence tests, the 1-in-100 test, the three-encodings test, and the real-fixture test).

## Root cause / probe (systematic-debugging.md)

- **Root cause:** `SchemaInferenceEngine.inferFromObjects`'s `PathAcc` seeded `nullable = false` and only flipped it on an explicit `JsNull` leaf in the per-object fold; a path simply absent from an object's `JsonFlattener.leaves` output never touched the accumulator at all, so the merged schema advertised an absence-heavy path as non-nullable.
- **Probe:** stashed the production fix and ran `sbt "testOnly com.helio.domain.engine.SchemaInferenceEngineSpec"` against the unmodified engine with the new/inverted tests already added.
- **Probe output:** 6 tests failed with `false was not equal to true`, including the real-fixture assertion `schema.fields.find(_.name == "stats.rec").get.nullable shouldBe true` — confirming the hypothesis predicted the exact symptom described in the ticket (stats.rec advertised non-nullable despite most sampled QB rows lacking it). Full transcript in `evidence/red-before.md`.

## Findings recorded per ticket scope

- **Type is not affected by the same defect (AC7):** absence supplies no value, so there is nothing for `widenJson` to join; a path integral (or string) in some objects and absent from the rest still infers the correct narrow type, never widened to `StringType`. Pinned by two new tests (Integer and String arms).
- **CSV path (ticket scope item 3):** already honours absence — `parseRfc4180Row(...).padTo(headers.length, "")` pads a short row's missing trailing cells to `""`, and the empty-cell check marks the column nullable. No code change was needed; added a clarifying comment and a regression test pinning this agreement with the JSON path.
- **Blast radius (ticket scope item 4):** `SchemaInferenceFacade.toSchemaFields` drops `nullable` before projecting to `SchemaField`, so no persisted `data_sources.inferred_schema` row changes and no re-inference-on-refresh alters a stored value. The `nullable` field only changes on the live `POST /api/sources/infer` / `POST /api/data-sources/infer` preview responses and on `WorkspaceContextColumn.nullable`, both recomputed per call.
- **HEL-893:** not encountered during this work — no `evidence/hel893-observation.md` was needed.
