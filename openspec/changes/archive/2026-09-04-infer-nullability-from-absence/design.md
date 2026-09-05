## Context

`SchemaInferenceEngine.inferFromObjects` folds `JsonFlattener.leaves(obj)` over the sampled objects into a
`Map[String, PathAcc]`, where `PathAcc(dataType: Option[DataFieldType], nullable: Boolean)` starts at
`PathAcc(None, nullable = false)`. Only a `JsNull` leaf sets `nullable = true`. Absence is structurally invisible: an
object that lacks a path simply yields no `(path, value)` pair, so the fold never visits that path for that object.
HEL-858's comment on `PathAcc` records this as deliberate ("design D2 -- absence never contributes"); HEL-868 reverses
that decision now that the dotted-path union makes absence the normal case rather than an edge case.

Verified pre-planning against the live tree:

- `WorkspaceContextService.scala:378` is `columns = fields.map(f => WorkspaceContextColumn(f.name, f.dataType,
  f.nullable, ...))` — the flag does reach assistant-facing column semantics. That file is owned by a parallel run
  (HEL-914) and is read-only here; no edit is needed there.
- `SchemaInferenceFacade.toSchemaFields` projects `InferredField` down to `SchemaField { name, type }`. `nullable` is
  **dropped before persistence**. `data_sources.inferred_schema` therefore stores no nullability at all.
- `inferShallowFromJsObjects` (HEL-891's pipeline-output path) hardcodes `nullable = false` by its own documented
  design D3, with the policy pinned by its caller in `PipelineRunService`. Out of scope here.

## Goals / Non-Goals

**Goals:**

- One composed rule: nullable iff at least one sampled object fails to supply a present, non-null value at the path.
- Order-independent, exactly as HEL-858 requires of type widening.
- Three encodings — absent, explicit `JsNull`, present-but-empty — distinguished in the spec and named in the tests.
- Prove the fix on the produced value: assert the inferred `nullable` for a path present in 1 of 100 rows.
- State, with evidence, whether inferred **type** shares the same absence-blindness.

**Non-Goals:**

- No Flyway migration; no database or schema change of any kind (binding run constraint — parallel worktrees share one
  dev Postgres).
- No browser/Playwright use; this is pure backend inference.
- No change to `inferShallowFromJsObjects`, `WorkspaceContextService.scala`, `PipelineService.scala`,
  `api/protocols/patchsets/`, the pipeline-proposal surface, or `helio-mcp`.
- No fix for HEL-893 (CSV declared-vs-materialized numeric types) even if its cause becomes visible here.
- No change to CSV widening order or CSV empty-cell semantics.

## Decisions

**D1 — Track the count of objects that supplied a non-null value, not a boolean.** Add a field to `PathAcc` recording
how many sampled objects supplied a present, non-null value at that path (`presentNonNullCount`), and compare it to the
total object count at projection time: `nullable = presentNonNullCount < objects.size`. Rejected alternative: a
pre-pass computing the union of paths and then a second pass marking any object missing a path. That is two traversals
of the same data for one boolean, and it recomputes `leaves` per object twice. Rejected alternative: keeping the
existing `nullable` boolean and OR-ing in "absent" — impossible without knowing, at fold time, which paths a given
object *did not* carry, which is exactly the information a per-object fold does not have. A count compared against a
constant total is the minimal state that makes absence observable, and it is trivially order-independent because
addition is commutative.

**D2 — `JsNull` increments nothing.** An explicit `JsNull` leaf leaves `presentNonNullCount` unchanged, so it makes the
path nullable by the same arithmetic that absence does. This is what collapses two rules into one: there is no separate
`nullable = true` assignment anywhere in the fold. HEL-858's D3 (a `JsNull` never participates in the widening join) is
preserved unchanged and independently — the type accumulator is untouched by this change.

**D3 — Present-but-empty stays a present, non-null value.** `JsString("")` increments `presentNonNullCount` and
contributes `StringType` to the join, exactly as any other string does. JSON distinguishes `""` from `null` from
absent on the wire, so the inference must too. CSV cannot: `parseRfc4180Row(...).padTo(headers.length, "")` makes a
short row indistinguishable from a row of empty cells, and `if (cell.isEmpty)` treats both as null. That conflation is
documented in the spec as a retained divergence rather than "fixed", because CSV has no encoding to distinguish them.

**D4 — The CSV path needs no code change.** Its `padTo` already treats a missing trailing cell as an empty cell and
marks the column nullable, so CSV already honours absence. After this change the two paths **agree on absence** and
**deliberately differ on present-but-empty**. The spec states both halves; a regression test pins the ragged-row
behaviour so the agreement is not accidental.

**D5 — Inferred type is not affected, and the change proves it rather than asserting it.** Absence supplies no value,
so there is nothing for `widenJson` to join; a path carried as integers by some objects and absent from the rest still
infers `IntegerType`. This is the correct behaviour, not a second latent defect: widening over "no value" has no
defensible answer other than "ignore it", and widening absence to `StringType` would be strictly worse (it would poison
every sparse numeric column). A test asserts `IntegerType` + `nullable = true` for that case so the claim is pinned,
not merely stated.

**D6 — Blast radius on existing schemas: none persisted, preview-only.** Because `SchemaInferenceFacade` drops
`nullable`, no stored `data_sources.inferred_schema` row changes and no re-inference-on-refresh alters a persisted
value. What changes is (a) the `nullable` field of `InferredFieldResponse` on the two infer-preview endpoints, and
(b) `WorkspaceContextColumn.nullable` for any Output whose fields carry a nullability flag — both recomputed live per
call, neither read back from storage. The user-visible effect is that a sparsely-present column stops claiming a
guarantee the data never honoured. This assessment is reported in the PR body, per the ticket's fourth acceptance
criterion.

## Risks / Trade-offs

- **More columns become nullable.** On a heterogeneous feed this is a large, deliberate flip, and it is the point of
  the ticket. The false-positive direction is guarded explicitly: a path present and non-null in every sampled object
  stays `nullable = false`, with its own scenario and test.
- **`objects.size` is the denominator, not "rows sampled from the source".** Sampling limits live upstream in the
  connectors; `inferFromObjects` sees exactly the objects it is handed. Nullability is therefore a statement about the
  sample, as the inferred type already is. No new sampling semantics are introduced.
- **Non-object elements in a root `JsArray` are dropped before the fold** (`elements.collect { case obj: JsObject }`),
  so the denominator counts only objects. This is pre-existing behaviour and is left unchanged; noting it because it is
  the one place `objects.size` could otherwise be mistaken for the input array's length.

## Planner Notes

Self-approved (no escalation): this is a bounded, single-function change to one backend object plus its spec and unit
tests, with no new dependency, no API-shape change (the `nullable` field already exists on the wire), and no
architectural decision. The one judgement call worth recording is the spec restructure: `openspec validate` refuses a
MODIFIED requirement that drops a scenario the current spec still has, and the scenario being dropped
(`Absence of a key does not by itself mark a field nullable`) is precisely the codified defect. The requirement is
therefore expressed as REMOVED + ADDED under the honest new name `JSON schema field enumeration`, with nullability
lifted into its own requirement and every surviving scenario carried over verbatim. This is a restructure, not a
deletion of behaviour.

If implementation reveals a genuine need for a schema/DB change, or for browser verification, stop and escalate — both
are hard run constraints, not preferences.
