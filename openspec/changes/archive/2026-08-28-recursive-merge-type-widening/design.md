## Context

See proposal.md — Why. Three constraints shape the approach:

1. `JsonFlattener.leaves` (HEL-599, merged 7972247c) is already the one bounded traversal, dedupes per
   path and sorts by path. Its scaladoc reserves this ticket's move: "HEL-858 is expected to replace
   row-set-level merge with a union/widen over the leaf *paths* this produces, without needing any
   change to this traversal itself."
2. `fromJson` merges raw objects FIRST (`mergeObjects`, line 82) and flattens SECOND. Both defects live
   entirely in that first step.
3. `PipelineRowJson.jsRowToRow` is the sibling projection of the same `leaves` call. HEL-599's final
   gate found the two disagreeing on colliding input because the row side folds into a `Map` and the
   schema side does not. That failure mode is the acceptance bar, not a footnote.

## Goals / Non-Goals

**Goals:** schema is a pure function of the SET of sampled objects; recursion comes structurally from
already-recursive paths, not a second walk that can drift; the schema and row projections stay in
agreement under adversarial input.

**Non-Goals:** any edit to `JsonFlattener` (D1 — if this design needs one, the design is wrong);
changing CSV inference (D3); re-inferring persisted DataTypes.

## Decisions

### D1 — Invert the pipeline: flatten each object, then merge over paths. Delete `mergeObjects`.

For each `JsObject` element call `JsonFlattener.leaves`; fold the `(path, value)` streams into a
per-path accumulator of `(widenedType, nullable, sawNonNull)`; emit one `InferredField` per path.

Why not "make `mergeObjects` recursive in place": that is a SECOND recursive traversal with its own
depth bound, dotted-key handling and collision semantics — the duplication HEL-599 existed to remove.
Worse, an object-level merge cannot express widening at all: it must pick ONE `JsValue` per key for
`inferJsonType`, which is defect 2 restated. `mergeObjects` has no other caller (verified by grep) and
is deleted, not left dead. The root-`JsObject` branch runs through the same accumulator as a
single-element case, so there is one code path.

### D2 — Nullability accumulates per path; absence deliberately does NOT imply nullable.

`nullable = true` iff some sampled object carries `JsNull` at that path. Absence contributes nothing.
This preserves today's semantics exactly (AC5) AS A RULE -- but the rule's observed OUTPUT
changes for any nested path that is null only in a non-first sampled object, and that consequence
must be stated rather than left implicit (the same standard D7 already holds itself to for its own
blast radius). Pre-fix, `mergeObjects` merges only top-level keys first-non-null-wins, so a nested
subtree from the first object wins wholesale and `withNulls`' second pass -- which only ever nulls
TOP-LEVEL keys -- never examines a null nested inside it. Post-fix, `inferFromObjects` unions leaf
paths across every sampled object, so a nested null that was previously invisible is now seen at
its own path. Observed on the existing WR-only fixture
(`backend/src/test/resources/hel599/sleeper-wr-projections-slice.json`, task 3.10):
`player.injury_body_part` and `player.injury_status` flip from `nullable = false` to
`nullable = true` (type unchanged, `StringType` both ways) -- see
`evidence/wr-fixture-characterisation.md`. This is NOT a D7 narrowing (D7 is a type change; here
the type is unchanged) and is direction `false -> true`, i.e. strictly more accurate, never a
silent loss of nullability information -- so AC5's INTENT (the rule is unchanged; nothing silently
becomes less nullable) genuinely holds, even though the flat claim above overstated it as "exactly"
unchanged in every observable respect.

Absence-implies-nullable is deliberately NOT adopted. Note it would move nullability only on
heterogeneous sources (in a single-shape source every key is present in every row, so absence never
arises). Grounds for deferring it: it changes a DIFFERENT requirement, it cannot be validated by the
order-independence test that is this ticket's central evidence, and bundling it makes the diff's blast
radius exceed the defect.

The consequence shipped must be recorded, not glossed: union-over-paths makes `nullable = false`
columns that are null in most rows the COMMON case for heterogeneous sources — a QB row has no
`stats.rec`, yet the schema will advertise it non-nullable. That flag reaches real consumers
(`DataTypeProtocol.scala:45`, `PanelCapabilityService.scala:69`, `WorkspaceContextService.scala:378`,
the last feeding the assistant's column semantics), so it misleads an LLM, not just internals.
Follow-up to file at Delivery: "Schema inference: a path absent from some sampled rows should infer as
nullable."

### D3 — The JSON widening join is a true lattice, deliberately diverging from CSV's order.

`widen(a, b)`: equal → that type; `Integer ∨ Float = Float`; `Timestamp ∨ String = String`; every
other distinct pair → `String`. Commutative, associative, idempotent, `String` at top.

CSV's `widenType(current: DataFieldType, value: String)` (line 135) is not a lattice — it widens a
running type against a raw cell and is order-sensitive (`Integer` then `"true"` → `Boolean`). Copying
that order would type a mixed number/boolean column as boolean, contradicting "mixed scalar types fall
back to string" and breaking order-independence, the central AC. So JSON gets its own join; the
divergence is stated normatively in the spec delta rather than left latent. `JsNull` never
participates; an all-null path infers `StringType, nullable = true`, matching `inferJsonType(JsNull)`.

### D4 — Field order and display names are unchanged.

`leaves` sorts globally by path and the accumulator emits in sorted path order, so the `InferredField`
sequence is stable and identical across permutations — required, since order-independence compares
whole `InferredSchema` values (a `Seq`), not sets. `displayName` is untouched.

### D5 — Cross-row leaf-vs-subtree collision: emit BOTH paths; do not collapse.

A failure class D1 newly creates (design gate CR1). Today `mergeObjects` runs before flattening, so for
row 0 `{"a": 1}` and row 1 `{"a": {"b": 2}}` row 0's scalar wins and only column `a` is emitted. Under
D1 the path union is `{"a", "a.b"}`. The collision is strictly BETWEEN objects, so `JsonFlattener`'s
per-object dedup cannot address it.

Decision: emit both, each typed by the join over only the values actually seen at that path. Not
"collapse the prefix to `StringType` and drop sub-paths" — that DELETES a real column `a.b` a row
genuinely carries, reintroducing this ticket's own defect on a narrower input class. Not
"last-row-wins" — that reintroduces order dependence. Emitting both needs no special case: `a` absent
from row 1 is the SAME situation as `stats.rec` absent from a QB row, the ordinary heterogeneous case
this change exists to support. Its consequence for the agreement property is handled in D6.

### D7 — Null-containing columns become typed. This is a NARROWING, and it is chosen deliberately.

Today `mergeObjects` runs a SECOND pass (`SchemaInferenceEngine.scala:93-97`) that overwrites a key's
value with `JsNull` whenever ANY sampled object has it null. `inferJsonType(JsNull)` then returns
`StringType`. So at present ANY column with a single null anywhere in the sample infers as
`StringType, nullable = true` — even when every other row carries a number. Under D3 (`JsNull` never
participates in the join) that same column now infers `IntegerType`/`FloatType`, nullable.

That is `String → Integer`: a NARROWING, on the very common "some rows null" case, and it applies to
single-shape sources too, not only the heterogeneous ones this ticket targets.

Decision: accept it. A numeric column typed `string` because one row was null is itself a defect — it
is the same class of ordering/sampling artefact this ticket exists to remove, and it silently disables
numeric aggregation on the column. Adopting it is the coherent reading of "the inferred schema is a
function of the data".

Blast radius, stated rather than assumed away: a panel bound to such a column expecting a string will
see it re-infer as numeric on next inference. No persisted DataType is rewritten by this change, so
nothing breaks at rest; the flip occurs only when a source is re-inferred. This is pinned by a spec
scenario, and task 3.10 must REPORT any `string → numeric` flip on the existing WR fixture rather than
absorb it as "legitimate widening" — it is not widening, it is the opposite.

### D6 — Test strategy: the agreement property stated correctly, and the RIGHT tests proven RED.

**Agreement property.** Naive "schema field-name Seq == the row's key set" is WRONG: it fails a CORRECT
implementation on every heterogeneous input, including D5's collision and the ordinary `stats.rec`
case. The property that actually holds is three-sided: (1) every
individual row's key set is a SUBSET of the schema's field-name set; (2) the schema's field-name set
equals the UNION of all rows' key sets; (3) the schema's field-name `Seq` has no duplicates — asserted
on the `Seq` itself, never on a fold into a `Map`/`Set` the schema side does not perform. That fold is
exactly what hid HEL-599's defect. Run over the adversarial set: within-object colliding dotted keys
(`{"a.b":1,"a":{"b":2}}`), cross-row leaf-vs-subtree (D5), dots inside keys, unicode and empty-string
keys, nulls, heterogeneous shapes, objects at and beyond `MaxDepth`, non-object array elements.

**RED-verification is classified, not blanket.** "Prove every new test RED" is unsatisfiable and
harmful: AC5's nullability tests, the WR-only control, and the within-object collision are
CHARACTERISATION tests that must be green both before and after. An executor told everything must go
red will fudge the transcript or reshape those tests until they fail, destroying their regression
value. Each test is classified in tasks.md as must-be-RED-on-revert or characterisation/GREEN-both-ways,
and the committed transcript must show EXACTLY that split. A characterisation test that goes red on
revert is itself a finding and must be reported.

**Fixture adequacy is asserted in code, not attested.** A checksum the executor computes over bytes it
captured proves only that it did not edit them after; an independent re-fetch cannot settle it either,
since Sleeper projections recompute continuously so a later fetch legitimately will not byte-match and
the check gets quietly waived. URL/timestamp/checksum are recorded for provenance, but the property
that makes the fixture MEANINGFUL (an earlier element lacking `stats.rec*`, a later one carrying the
full `rec_*` family) is asserted by the test, so a degenerate or resampled capture fails loudly.

**AC3's truncation clause is tested end-to-end, where truncation can happen AND where the fix drives
it.** `PipelineRowJson.jsValueToAny` maps `JsNumber` to `toDouble` unconditionally, never consulting the
declared type, so a truncation test there is green before and after the fix. The only
declared-type-driven narrowing is `SparkJobSubmitter.jsValueToAny`
(`case (JsNumber(n), IntegerType) => n.toInt`), reached via `sparkDataType("integer")`, and
`SparkJobSubmitterSpec` already drives `loadDataFrame` over static sources in local Spark mode. But
demonstrating truncation there with a HAND-DECLARED `integer` column is still green on revert — the
declared type must itself come from `SchemaInferenceEngine.fromJson` over rows containing `3` then
`2.5`. Pre-fix inference declares `integer` and Spark truncates `2.5`→`2`; post-fix it declares `float`
and the value survives. Only that wiring makes AC3 load-bearing and red on revert.

## Risks / Trade-offs

- [Schemas change on re-inference — a column may flip `integer → float`, new columns appear] → That is
  the fix. No persisted DataType is rewritten by this change; the flip happens only when a source is
  re-inferred.
- [Re-inference CAN narrow a column] → Correct and intended, per D7: a column that today infers `StringType` purely because one sampled row was null
  will now infer numeric. Widening across non-null values is strictly loosening, but the null rule
  change is not, and a panel bound to such a column expecting a string is the real exposure. Pinned by
  a spec scenario and surfaced by task 3.10 rather than absorbed.
- [Per-path accumulation touches every leaf of every sampled row] → Bounded by `MaxDepth` and the
  existing sample size; the same work `jsRowToRow` already does per row, not a new order of cost.
- [`String`-absorbs-everything stringifies a mixed-type column] → Intended and specified; the
  alternative is the truncation bug being fixed, and a stringified column is visibly wrong to a user
  where a truncated float is not.
- [CSV/JSON widening divergence becomes a future trap] → Stated normatively in the spec delta and in a
  code comment at the join.
- [D5 emits a schema field no single row carries] → Correct and intended under union semantics; it is
  why D6's property is subset+union rather than equality against one row.

## Planner Notes

Self-approved: deleting `mergeObjects` (no external callers, verified by grep); expressing the
root-object case via the array path; keeping `inferJsonType`'s per-value rules and composing them with
the new join rather than rewriting them.

Carried from the design gate's non-blocking notes: deleting `mergeObjects` leaves two dangling prose
references (`JsonFlattener.scala:36`'s contract block and `NestedJsonFlatteningSymmetrySpec.scala:15`)
to update in the same diff. Separately, `inferJsonType` types `2.0` as `IntegerType`, so a
fractional-valued column sampling only whole floats still infers `integer` — out of scope and
deliberately left alone, but stated in the delivery report so it is not mistaken for a miss.

Deferred rather than guessed: absence-implies-nullable (D2), recorded for follow-up triage at Delivery.

## Gate-Chain Implications Checklist

Not applicable — this change touches no `.husky/**` hook and no script any commit-gate invokes. It is
confined to backend Scala sources and their tests. Recorded explicitly so the Delivery-time
`check-gate-chain-change.sh` assertion has a stated answer rather than an omission.
