## Context

See proposal.md - Why. The root cause is probe-confirmed against live-API payloads; the measurement table is in
`ticket.md` and the payloads are staged at `.hel1015-realdata/`.

Two facts shape everything below.

**1. Map-ness is not a property of one object.** "Keys are data, not schema" is a statement about how keys vary ACROSS
rows. A single `{"10229": 12.4}` is indistinguishable from a struct with one field. But `JsonFlattener.leaves` is
per-object by contract ("Purely per-object: no cross-row merge policy lives here"), so the classifier cannot live
inside it and must be computed over a batch and passed in.

**2. `JsonFlattener.leaves` has three consumers, and they must not diverge.** `SchemaInferenceEngine.scala:113`
(schema), `PipelineRowJson.scala:100` (rows), `SourceService.scala:421` via `flattenJsObject` (preview). HEL-599's
whole point was that schema and rows derive from ONE traversal; `SourceService`'s own comment warns that a preview
which flattens differently would create "a *new* three-way divergence on a user-facing surface". A fix that corrects
the schema alone re-introduces precisely the hazard `JsonFlattener`'s header warns about — a schema advertising a
column the row never carried. **Schema and rows move together or not at all.**

## Goals / Non-Goals

**Goals:**

- A map-keyed field yields exactly one bounded column, and the same one on all three surfaces.
- A field null in some rows and an object in others resolves to exactly ONE declared type.
- Struct flattening is preserved, verified against the real near-miss (`stats`, coverage 0.580), not assumed.

**Non-Goals:**

- See proposal.md - Non-goals. Additionally: no change to the `MaxDepth` bound, the dedup/`ListMap` policy, or the
  global path sort — all orthogonal and load-bearing for other tickets.

## Decisions

**D1 (REVISED, design gate r1 CR2) - The classifier is cross-row, computed once per batch, and threaded as a
REQUIRED parameter.** Add `JsonFlattener.detectMapPaths(objects: Seq[JsObject]): Set[String]` and make the production
traversal `leaves(obj: JsObject, mapPaths: Set[String])` take `mapPaths` REQUIRED — no default, no same-named
single-argument overload. Round 1 correctly found that the original plan (keep `leaves(obj)` as an overload) made D1's
own mitigation false: a missed call site would compile cleanly and silently keep flattening maps, which is exactly the
schema/row divergence this design calls its worst risk. Test-only and genuinely-single-object callers use a separately
NAMED helper (e.g. `leavesUnclassified`) so the omission is explicit at the call site and greppable by name; production
code cannot omit the parameter. **This applies to `flattenJsObject` too (design gate r2 CR1)**: it is how the third
consumer (`SourceService.scala:421`, preview) calls in, so it takes `mapPaths` as a REQUIRED parameter as well, with
its own separately-named unclassified variant for the existing test callers (`ExpressionEvaluatorSpec:432,445`,
`JsonFlattenerSpec:144`). Leaving `flattenJsObject` single-argument would let the preview consumer compile cleanly
while silently flattening maps — the exact divergence this decision exists to make impossible, so the guarantee must
cover BOTH entry points or it is not a guarantee. With that, "a missed consumer is a compile-time error" is TRUE as stated rather than
aspirational. Each of the three consumers computes `mapPaths` ONCE over
the batch it holds and passes the same set to every per-row `leaves` call. Alternative rejected: inferring map-ness
per object inside `leaves` — impossible in principle (see Context 1) and would make schema and rows disagree row by
row, which is strictly worse than the bug being fixed.

**D2 (REVISED, design gate r1 CR1+CR4) - The heuristic is COMPOUND: low coverage AND an empty key intersection.**
For a path P present as an object in rows R, let `union` be all keys seen at P, `coverage = mean(|keys(row)| / |union|)`
and `intersection` be the keys present in EVERY row of R. P is a MAP iff `coverage < 0.25` AND `intersection` is empty
AND `|R| >= 2`. Measured on payloads STAGED IN THIS WORKTREE (`.hel1015-realdata/`), so every number is reproducible:

| field | source file | coverage | intersection | true shape |
| -- | -- | -- | -- | -- |
| `adds` | `tx.json` | 0.045 | 0 | MAP |
| `drops` | `tx.json` | 0.062 | 0 | MAP |
| `players_points` | `matchups.json` | 0.083 | 0 | MAP |
| **synthetic variant payload** | fixture | **0.122** | **1** | **STRUCT** |
| `stats` | `projections-sample-200.json` | 0.580 | 16 | STRUCT (near-miss) |
| `settings` | `tx.json` | 0.682 | 1 | STRUCT |
| `metadata` | `tx.json` | 1.000 | 1 | STRUCT |
| `player` | `projections-sample-200.json` | 1.000 | 14 | STRUCT |

The intersection clause exists because round 1 named the shape that defeats coverage alone: a POLYMORPHIC/VARIANT
payload (a `type` discriminator plus variant-specific fields — webhook and event feeds, and Sleeper's own transaction
`metadata`, have this shape). Ten variants of four fields measures `coverage = 0.122`, BELOW the 0.25 threshold, and
D3's 2-row minimum does not help because such a sample has many rows. Coverage alone would classify it MAP and
collapse columns pipelines are bound to. But every variant shares its discriminator, so `intersection >= 1`, while all
three real maps have `intersection` of exactly 0 — keys that are data have no reason to recur in every row. The
compound rule classifies the counterexample correctly, verified above.

Alternatives rejected: (a) *key-count threshold* — `stats` (52) exceeds `drops` (16), so no cut exists; (b) *keys look
numeric/opaque* — `drops.MIN` is a non-numeric map key and a struct may legitimately have numeric-looking keys, so it
is neither necessary nor sufficient; (c) *intersection alone* — `settings`/`metadata` score only 1, too close to 0 to
carry the decision by itself, which is why it is a conjunct and not a replacement.

**D2a (design gate r1 CR3) - Recursion rule: OUTERMOST-WINS, denominator is parent-present rows.** For a nested path,
`coverage`'s denominator is the number of rows in which the PARENT is present as an object (not the total sample), so
an optional nested struct is not penalised for its parent's absence. Classification proceeds top-down and is
OUTERMOST-WINS: once a path is classified MAP it becomes a single leaf under D4, and no path beneath it is classified
or emitted — consistent with "one leaf" and the only reading under which schema and rows can agree. A path at
`MaxDepth` is already a leaf by the existing contract and is never classified; `MaxDepth` behaviour is unchanged. A
map whose VALUES are objects is therefore one leaf carrying the whole nested structure as compact JSON.

**D3 - Fewer than 2 object-rows defaults to STRUCT.** With one sample there is no cross-row signal, and defaulting to
struct preserves today's behaviour exactly — the conservative direction, since misclassifying a struct as a map would
silently collapse real columns that pipelines are already bound to. Consequence to state plainly: a single-row sample
of a genuinely map-shaped field still explodes. That is a deliberate, bounded limitation, not an oversight.

**D4 - A map path becomes ONE leaf carrying compact JSON text, reusing the existing array precedent.** `JsonFlattener`
already treats `JsArray` as "a leaf at its own dotted path", and `PipelineRowJson.jsValueToAny` already renders a
non-scalar leaf via `compactPrint`. Classifying a map path as a leaf therefore needs no new type and no new row-value
path: schema gets one `StringType` column, the row gets the compact JSON text, and both fall out of the same
traversal. Alternative rejected: a dedicated map/JSON `DataFieldType` — it would ripple through every `DataFieldType`
consumer (panels, pipeline ops, schema wire shapes) for no acceptance-criteria gain. Worth revisiting separately if
map columns ever need to be queried structurally.

**D5 - The `drops` case resolves to exactly one nullable string column, and this is the modelling decision.** `drops`
is `null` in 19 of 36 rows and an object in the other 17. Under D4 the object rows contribute a single leaf at path
`drops`; the null rows already contribute a `JsNull` leaf at that same path. So there is exactly ONE path `drops`, and
`inferFromObjects`' existing arithmetic (`SchemaInferenceEngine.scala:111-138`) does the rest unchanged: `JsNull` does
not participate in the widening join, the object rows supply `StringType`, and `presentNonNullCount (17) < objects.size
(36)` yields `nullable = true`. No `drops.<id>` column is emitted at all, so the scalar-and-prefix collision cannot
occur — it is resolved structurally rather than by a special case. Explicitly NOT chosen: making `drops` non-nullable
(false — a third of rows have no value), or inventing a "map-or-null" union type (no consumer could bind it). The
downstream consequence for row materialisation is stated and intended: a `drops` cell is either `null` or a JSON
string, never a set of per-id columns.

**D6 - Every consumer must classify over the SAME rows it will emit, and preview is the trap.**
`SourceService.scala:421` currently flattens `jsRows.take(10)`. If it classified over those 10 rows while inference
classified over the full sample, the two could disagree — the exact three-way divergence its own comment warns about.
Therefore preview MUST call `detectMapPaths` over the FULL `jsRows` and only then `take(10)` for display. Ordering,
not logic. `InProcessPipelineEngine.scala:647,655` already map over the whole batch (`outcome.rows.map(...)`), so it
classifies over that same batch; `SchemaInferenceEngine.inferFromObjects` already receives `objects: Seq[JsObject]`.

**D7 (REVISED, design gate r1 CR5) - Residual, stated in the invariant's own terms and accepted.** Two fetches can
classify differently if the data changes shape between them. Said precisely: the schema is inferred on one fetch while
rows are materialised on another, so after a shape change the STORED SCHEMA CAN ADVERTISE `drops.<id>` COLUMNS WHILE
THE RUN'S ROWS CARRY A SINGLE COMPACT-JSON `drops` — the same "schema advertises a column the row never carried"
hazard, displaced across fetches rather than within one. This is accepted: it is not eliminable by any per-batch rule,
today's code has the identical cross-fetch property, and the classification is far more stable than the per-key column
set it replaces. It is stated in these words so the acceptance is of the real thing, not a softened version of it.

## Risks / Trade-offs

- [A struct with many optional fields drops below 0.25 and collapses to one column] -> **This failure is SILENT, not
  loud.** The earlier claim that it would be loud contradicted `ticket.md` §1's own account, which says a vanished
  column "silently stops resolving, with no warning" — the same mechanism, so it cannot be silent when the data causes
  it and loud when this heuristic does. Corrected here. Mitigations are therefore real ones, not optimism: the
  intersection conjunct (D2) rules out the known variant-payload counterexample; the staged near-miss `stats` sits at
  0.580 with intersection 16; fixtures pin both sides of the boundary; and D3 defaults to struct when there is no
  signal. Residual, stated by MEASURED REACHABILITY rather than by shape (design gate r2 CR3): the struct-side failure is
  reached not only by a payload that structurally lacks a shared key, but by a SINGLE ROW MISSING THE SHARED KEY —
  deleting the discriminator from one row of a ten-variant payload flips intersection 1 -> 0 and the classification
  STRUCT -> MAP (coverage 0.1195). That is materially more reachable than "a payload with no shared key" implies, and
  it is the direction that loses columns silently. Accepted, and pinned as a fixture alongside task 4.4a so the
  behaviour is asserted rather than incidental.
- [A genuine MAP whose sampled rows coincidentally share a key is classified STRUCT and keeps exploding] -> This is
  the intersection conjunct's own failure mode, in the MAP direction, and it is named here rather than left implicit
  (design gate r2 CR2). Measured on the staged payloads: `adds` has a non-empty intersection in 25/630 two-row subsets
  (4.0%) and 9/4000 three-row subsets (0.2%); `drops` 1/136 at n=2. Larger samples make it rapidly rarer. ACCEPTED
  explicitly: this is the CONSERVATIVE direction — the outcome is identical to today's behaviour (the field explodes,
  exactly as it does now), so it is never a schema/row divergence and never worse than the status quo. It is bounded
  by sample size rather than eliminated.
- [Schema/row divergence if one consumer is missed] -> D1 makes `mapPaths` an explicit parameter rather than ambient
  state, so a missed consumer is a compile-time change site, and the tasks enumerate all three by file and line.
- [Row materialisation and inference run on different fetches and disagree] -> D7; accepted and stated.
- [Persisted schemas stay wrong] -> Out of scope by ruling; HEL-1030 filed and named in the deferral.

## Planner Notes

Self-approved: `skip_specs: true` (no spec-level behaviour change); threshold 0.25 and the 2-row minimum, both
grounded in the measured table in D2 rather than chosen a priori.
