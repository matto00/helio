## Why

`SchemaInferenceEngine.inferFromObjects` marks a JSON path nullable only on an explicit `JsNull` leaf. A path simply
absent from a sampled object contributes nothing, so the merged schema advertises it non-nullable. HEL-858's dotted-path
union made this the common case: on a mixed-position feed, `stats.rec` is unioned in from receiver rows and claimed
non-nullable even though most rows lack it. That flag reaches an LLM through the workspace context, and wrong metadata
handed to a model is worse than absent metadata, because the model cannot detect it.

## What Changes

- JSON inference treats **absence** as evidence of nullability: a path present in at least one sampled object but
  missing from at least one other is inferred `nullable = true`.
- Absence and present-null compose into a **single stated rule**: a field is nullable iff at least one sampled object
  fails to supply a non-null value at that path. Two rules become one.
- The spec scenario that currently asserts the opposite ("Absence of a key does not by itself mark a field nullable")
  is replaced, not merely supplemented.
- All three encodings — absent, explicit `JsNull`, present-but-empty (`JsString("")`) — are enumerated normatively and
  covered by tests that name which encoding each exercises. Present-but-empty stays **non-null** in JSON.
- The CSV path is examined and its behaviour stated relative to JSON: a short/ragged row already pads to `""` and marks
  nullable, so CSV already honours absence. Its empty-cell conflation of "empty" with "null" is documented as a
  deliberate, retained divergence, not silently aligned.
- Inferred **type** is checked for the same absence-blindness and the finding stated in the spec.
- The blast radius on persisted schemas is assessed and recorded.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `schema-inference`: the JSON nullability rule is restated as one composed absent-or-null rule; the "absence does not
  mark nullable" scenario is replaced; the three encodings and the JSON/CSV divergence are stated normatively.

## Impact

- `backend/src/main/scala/com/helio/domain/engine/SchemaInferenceEngine.scala` (`inferFromObjects` only).
- `backend/src/test/.../SchemaInferenceEngineSpec` (and any test asserting the old non-nullable-on-absence behaviour).
- Wire-visible on `POST /api/sources/infer` / `POST /api/data-sources/infer` (`InferredFieldResponse.nullable`).

## Non-goals

- No Flyway migration, and no schema/DB change of any kind.
- No change to `inferShallowFromJsObjects` (HEL-891's pipeline-output path, caller-pinned nullability).
- No change to the CSV widening order or its empty-cell semantics.
- No fix for HEL-893 (CSV declared-vs-materialized numeric types), which has its own run.
- No change to `WorkspaceContextService.scala` or any file owned by a parallel run.
