# Design — HEL-599 nested JSON row flattening

## Context

Two functions independently decide what nesting means, and they disagree:

- `SchemaInferenceEngine.flattenObject` (`SchemaInferenceEngine.scala:101`) recurses into `JsObject` values and
  emits dotted, typed `InferredField`s.
- `PipelineRowJson.jsRowToRow` (`PipelineRowJson.scala:87`) maps one level; a nested `JsObject` falls into
  `jsValueToAny`'s `case other => other.compactPrint` and becomes a raw JSON string under the top-level key.

The duplication *is* the defect. Adding a second flattening implementation on the row side would restore
agreement today and let it drift again tomorrow. The design therefore extracts one traversal and derives both
paths from it, so agreement is structural rather than maintained by discipline.

## Decision 1 — one traversal, two projections

Introduce `JsonFlattener` in `com.helio.domain.engine` exposing a single leaf enumeration, roughly:

```scala
def leaves(obj: JsObject): Seq[(String, JsValue)]
```

returning `(dotted path, leaf JsValue)` pairs in a deterministic order.

- `SchemaInferenceEngine.flattenObject` becomes `leaves(obj).map { case (p, v) => InferredField(p, displayName(p), ...inferJsonType(v)) }`.
- `PipelineRowJson.jsRowToRow` becomes `leaves(obj).map { case (p, v) => p -> jsValueToAny(v) }.toMap`.

Both projections are total over the same pair list, so the field-name set and the column-key set are equal by
construction, for every input. Nothing about the *typing* rules moves: `inferJsonType` stays in
`SchemaInferenceEngine` and `jsValueToAny` stays in `PipelineRowJson`. `JsonFlattener` knows only about
structure — what is a leaf and what its path is. That separation is what lets HEL-858 change how types are
merged across rows without touching traversal, and lets this ticket change traversal without touching types.

Rejected: passing a callback into a single generic `flatten[A](obj)(f: JsValue => A)`. It expresses the same
guarantee but forces both call sites through an inversion of control for no benefit; a returned `Seq` is
simpler to test directly, and the symmetry test (Decision 7) asserts the guarantee explicitly anyway.

Rejected: making rows carry a nested `Map` and flattening at read time. Rows are `Map[String, Any]` consumed
by ~24 step implementations that all address columns by exact key; deferring the flatten would require every
one of them to learn about nesting.

## Decision 2 — arrays are leaves, both kinds

An array terminates traversal. Array-of-scalars and array-of-objects behave identically: one leaf, at the
array's own dotted path. The row value is the array's compact JSON text (already what `jsValueToAny` produces)
and the inferred type is `StringType` (already what `inferJsonType`'s catch-all produces). So this decision is
"keep today's array behaviour, and write it down" — it changes no code path, which is exactly why it is safe to
state as a contract.

Rejected: index expansion (`games.0.pts`). The column set would then depend on how many elements each row's
array happened to contain, so a source's schema would change between refreshes purely with the data — the same
ordering-dependent-schema failure mode as the field report's issue #2, which HEL-858 exists to fix. Adding a
second instance of that failure while a sibling ticket removes the first would be indefensible.

Rejected: leaving arrays undefined. The ticket calls this out directly: undefined behaviour is how this class
of bug returns.

Consequence to document for users: an array-valued field is still opaque. That is a known limitation, not an
oversight, and it is bounded — the Sleeper blocker is nested *objects*, which this fixes.

## Decision 3 — bounded depth, subtree-becomes-leaf at the bound

`MaxDepth = 10`, a constant on `JsonFlattener`. An object encountered at the bound is treated as a leaf: its
compact JSON text as the row value, `StringType` as the inferred type — the same treatment an array gets.

The bound exists so a pathological or cyclic-looking response cannot produce an unbounded column set (a
runaway schema is a persistence and UI problem, not just a CPU one). Behaviour at the bound is degradation, not
failure: no exception, no dropped top-level column, no truncated row. Because the bound lives in the single
shared traversal, inference and rows hit it at exactly the same place — a bound applied in only one of the two
would reintroduce this very bug at depth 10.

10 is chosen as far beyond any real API shape (Sleeper's deepest is 3) while still finite.

## Decision 4 — deterministic collision resolution

`{"a.b": 1, "a": {"b": 2}}` generates the path `a.b` twice. Deduplication happens inside the traversal itself
(a `ListMap` fold in walk order, last wins, before the sort), NOT in the projections — final-gate round 1
refuted the original "both projections build a `Map`, so the last pair wins" premise: `jsRowToRow` does fold
into a `Map`, but `SchemaInferenceEngine.flattenObject` builds its field `Seq` straight from `leaves` and never
folds, so a duplicate path reached the shipped DataType as a duplicate field name. Deduplicating in `leaves`
makes the two projections agree by construction rather than by caller discipline; the traversal returns pairs sorted by generated path, making "last wins" a stable, reproducible outcome rather than a hash-order accident. Both
paths consume the same ordered `Seq`, so they select the same value.

Note this is a *global path* sort, not `flattenObject`'s current *per-level* `sortBy(_._1)`; the two differ when
a key sorts between a sibling and that sibling's dotted children (`a-b` vs `a.z`, since `-` < `.`). Harmless for
correctness — both projections consume the same `Seq` — but an existing test asserting inferred field order may
need updating, and flat input is unaffected.

Not escalated as a product question: this is pathological input with no correct answer, and the requirement
that matters — schema and rows never disagree — holds either way. It is specified and tested so the behaviour
cannot silently change.

## Decision 5 — curated selector error via the existing envelope

`RestApiConnectorDriver.toRows` currently returns `Vector.empty` on a selector miss plus a warn log; its own
comment names HEL-599 as the owner of the real envelope. Add:

```scala
def toRowsEither(json: JsValue, rootSelector: Option[String]): Either[String, Vector[JsValue]]
```

`Left` only when a selector was supplied and the walk failed (missing segment, or descending through a
non-object). Every other outcome is `Right`, including a genuinely empty array — an empty result and a broken
selector must stay distinguishable, which is the whole point of the criterion.

There are **four** `toRows` call sites, not three (design-gate round 1 finding — the original enumeration
missed one):

| Call site | How a `Left` surfaces |
|---|---|
| `RestApiConnectorDriver.inferSchema` (:320) | existing `Either[String, _]` → HEL-468 `fetchError` |
| `RestApiConnectorDriver.fetch` rows (:325) | existing `Either[String, _]` → `fetchError`; `InProcessPipelineEngine.loadRows` already maps `Left` to a failed future, so a broken selector fails the run loudly instead of yielding zero rows |
| `RestApiConnectorDriver.inferSchemaEphemeral` (:387) | existing `Either[String, _]` → `fetchError` |
| `SourceService.previewRest` (`SourceService.scala:342`) | `ServiceError.BadGateway(err)`, reusing the HEL-311 curated pass-through already present at `SourceService.scala:336-340` |

`previewRest` matters most of the four: it is the surface where a user configures a `rootSelector` and
immediately looks at the result, so it is where a silent empty success is actually observed. It needs no new
error channel — `BadGateway` with the curated pass-through is already there, one call site to change.

The message names the selector and the failing segment and nothing else — no response body, no header, no
credential (HEL-311 curation convention). `toRows` is kept as a wrapper for the unset-selector path so the
"byte-identical when unset" criterion is verifiable against an unchanged function.

## Decision 6 — blast radius, and what deliberately does not change

- **Static sources** (`parseStaticRows`) keep per-field `jsValueToAny` with no flatten. Their columns are
  user-declared and never inferred, so there is no schema to disagree with. Unchanged.
- **Image connector** (HEL-216): its nested `content` `Map` row value is built by
  `InProcessPipelineEngine.loadImageRowFromBytes`, **not** by `jsRowToRow`, so it cannot be flattened by this
  change. `anyToJsValue`'s `Map` case must remain untouched — it is the write side, and a task asserts this.
- **SQL sources**: `SqlConnectorDriver.toRows` always produces flat `JsObject`s, so behaviour is unchanged in
  practice while inheriting correctness if that ever stops being true.
- **Source preview (`SourceService.previewRest`) DOES flatten** — decided explicitly, because this change is
  what would otherwise create the divergence. Preview stays in `JsValue` space and never touches `jsRowToRow`
  (`applyComputedFields(rows: Vector[JsValue], ...)`, `SourceService.scala:379-382`), so without a decision here
  the preview table would render `stats` as a nested object while the DataType advertises `stats.pts_ppr` and
  the executed rows carry it — a *new* three-way disagreement, on a user-facing surface, created by the fix that
  exists to remove exactly that class of disagreement. So `JsonFlattener` gains a third projection,
  `flattenJsObject(obj: JsObject): JsObject` (leaves → flat `JsObject`), applied to preview rows before
  `applyComputedFields`. Preview, schema, and executed rows then all agree. Side effect, accepted: a computed
  field's expression now sees flat dotted keys, which are the same keys the DataType advertises — more correct
  than today, though still not referenceable by expression syntax (D9).
- **`jsRowToRow`'s non-object fallback** (`Map("value" -> ...)`) is unchanged — it exists for a REST root that
  is a bare scalar.
- No migration, no wire-format change, no frontend change. Existing `data_type_rows` snapshots are historical
  records and are not rewritten; a re-run repopulates them correctly.

## Decision 7 — verification that a flat fixture cannot fake

The failure mode this ticket must not repeat is a green test over a fixture that was already flat. So:

1. **Symmetry property test.** Over a set of genuinely nested inputs, assert
   `inferredFieldNames(json) == materialisedColumnKeys(json)` directly. This is the regression test the
   acceptance criteria name, and it fails today.
2. **Negative control.** Assert explicitly that the pre-fix shape is gone: no column whose value is JSON text
   starting with `{`, and no `stats` column alongside `stats.pts_ppr`. A test that only asserts the new column
   exists would still pass if the old one were left behind too.
3. **Captured real payload.** The CI fixture is a verbatim capture of the live Sleeper projections response
   (trimmed to a few players, values unmodified), not a hand-written object. Hand-written fixtures are how
   nesting quietly disappears from a test.
4. **Live endpoint probe.** A recorded manual run against
   `https://api.sleeper.app/projections/nfl/2026?season_type=regular&order_by=pts_ppr&position[]=WR` creating a
   real source and reading rows back, with the transcript persisted as run evidence. Deliberately **not** a CI
   test: a network-dependent test in the commit gate is a flake generator. The criterion says "not only a
   fixture", and a recorded probe plus a captured-from-live fixture satisfies that honestly.

## Decision 8 — HEL-858 seam

HEL-858 makes inference merge recursively with type widening across sampled rows. Today `mergeObjects` keeps
the first non-null value per key, so a nested sub-key present only in a later row is never seen —
`SchemaInferenceEngine` merges *objects* before flattening.

The seam that helps 858: after this change, `leaves` gives 858 a per-row leaf enumeration it can merge over
*paths* (union the path sets, widen the type per path) instead of merging raw objects and then flattening.
That is strictly easier than what it faces today, and it needs no change to `JsonFlattener` itself. This
ticket must therefore leave `leaves` as a pure per-object function with no merge policy baked in — no
"first wins", no widening, no cross-row state. Row-set-level policy stays in `SchemaInferenceEngine` where 858
will replace it.

### Known residual in `mergeObjects` — named, and deliberately left to HEL-858

Design-gate round 2 established two concrete ways cross-row merge still under-reports nested fields, both
upstream of this change's traversal and both inside `mergeObjects`:

1. **First-non-null-wins per top-level key** (`SchemaInferenceEngine.scala:85-87`). A nested sub-key present
   only in a later sampled row never reaches the schema. Confirmed on this ticket's own mandated payload: the
   live Sleeper WR response has 32 `stats` keys in row 0 and 34 across the first 50 rows.
2. **The `withNulls` pass** (`:91-97`) replaces a key's merged value with `JsNull` if *any* sampled row is null
   there. For a nested object that collapses `stats` to a single flat `StringType` field while the rows carry
   `stats.pts_ppr` — the ticket's exact defect shape, surviving in a null-heterogeneous payload.

**Decision: out of scope here.** Both are cross-row *merge policy*, which is precisely HEL-858's subject; fixing
either would silently deliver that ticket and deny it a real design gate. What this change guarantees is
narrower and still worth having: for any single row object, the schema derived from it and the row materialised
from it agree exactly. The residual is recorded in the `pipeline-run-execution` spec, and in the PR body beside
the other risks, so AC #1 is not read as promising more than is delivered.

Explicitly not done here: any change to `mergeObjects`' first-non-null-wins semantics. Inference over an array
of rows keeps behaving as it does today, bug included. Fixing it here would silently deliver 858 and rob its
own gate of a real review.

## Decision 9 — known limitation: dotted columns in expressions

Verified in `ExpressionEvaluator.scala`: the tokenizer builds identifiers from letters, digits and `_` only
(`:129`, `:144`), and `.` begins a number token (`:135`) — `$stats.pts_ppr` lexes as `Ref("stats")` followed by
a bare `.` that fails as a number literal. So `compute`/`filter` cannot address a dotted column even after this
fix — matching the field report's "compute config error".

The same limitation applies to **source computed fields**, which run through the same evaluator
(`SourceService.applyComputedFields` → `ExpressionEvaluator.evaluate`). The spinoff ticket scopes both surfaces,
and the documentation names both.

Key-addressed steps are unaffected and start working immediately: `select` is a key-set intersection
(`SelectStep.scala:50`), and `lookup`/`sort`/`dedupe`/`rename` likewise address columns by exact key.

**Workaround to document:** a `rename` step maps `stats.pts_ppr` → `pts_ppr`, after which expressions work
normally. This makes the limitation non-blocking for the Sleeper use case, which is why it is a follow-up
rather than scope creep here — admitting `.` into the expression lexer is a change to a frozen legacy parser
with its own compatibility surface, and belongs in its own ticket with its own design gate.

A spinoff ticket is filed at Delivery. The limitation and its workaround are documented in
`openspec/specs/nested-json-flattening` follow-up notes and in the PR body.

## Risks

- **Silent column-shape change for existing nested sources.** A source that today has a `stats` JSON-string
  column will, after a re-run, have `stats.pts_ppr` instead. Panels bound to `stats` break. Judged correct:
  `stats` was never a column the DataType advertised, so nothing legitimately depends on it, and the ticket's
  premise is that those consumers are already receiving `null`. Called out in the PR body.
- **Column-count growth.** A wide nested object becomes many columns. Bounded by the depth limit and by
  arrays-as-leaves; no per-row array expansion means no unbounded growth.
