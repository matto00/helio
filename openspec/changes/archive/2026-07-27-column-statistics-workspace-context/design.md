## Context

`WorkspaceContextService.toDataTypeEntry` (HEL-372) already fetches a bounded, SQL-tier-limited row
snapshot for every pipeline-output DataType via `dataTypeService.listRows(dt.id, user, limit =
Some(SampleRowLimit), excludeKeys = contentFieldNames(dt.fields))`, and derives `sampleRows` from it via
the pure `sanitizeSampleRows(fields, rawRows)`. `excludeKeys` already strips Content-category
(`string-body`/`binary-ref`, HEL-217, up to `TEXT_MAX_FILE_SIZE_BYTES`/`IMAGE_MAX_FILE_SIZE_BYTES` = 10–20
MB per cell, `DataSourceService.scala:63-79`) field values *inside the query* — Postgres never sends those
bytes to the app. `helio-mcp/src/context.ts` independently re-implements the same rules in TS (no shared
runtime, HEL-372 design.md D6) and fetches via `api.getDataTypeRows(t.id, SAMPLE_ROW_LIMIT, true)`.

Column statistics are inherently a full-column aggregate — every prior ticket's caps (row `LIMIT`,
Content exclusion) exist precisely to keep this ticket from becoming an unbounded scan.

## Goals / Non-Goals

**Goals:**
- Add `columnStats` to every `dataTypes[]` entry: `nullRate`, `distinctCount` (capped) +
  `distinctCountCapped`, up to 5 example values for every Structured-category column; `min`/`max`/`mean`
  additionally for numeric (`integer`/`float`) columns.
- Bounded by construction: one SQL-tier-`LIMIT`ed fetch (no full-table scan, no new query path), a hard
  per-value char cap during aggregation, and a documented worst-case byte/row cost.
- Deterministic output for identical input rows (stable example-value ordering, fixed mean rounding).
- Backend and MCP compute `columnStats` identically, from the same bounded fetch each side already makes.

**Non-Goals:**
- Semantic/type classification, joinability (separate HEL-345 ticket).
- Token budgeting for the overall context payload (HEL-377/separate ticket).
- Exact cardinality/statistics over a DataType's true full row count once it exceeds the bounded fetch —
  see D1's explicit trade-off.

## Decisions

**D1 — One shared bounded fetch serves both `sampleRows` and `columnStats`; its row cap moves from 5 to a
new, larger, still-hard-`LIMIT`ed constant (`StatsRowLimit = 500`) — not a full scan, not a second query —
AND its column set is now capped at the SQL tier itself, not just after fetch (round-1 skeptic finding,
closed for real below).** `toDataTypeEntry` already makes exactly one `listRows` call per pipeline-output
DataType. This ticket raises that call's `limit` from `SampleRowLimit` (5) to `StatsRowLimit` (500) and
derives *both* outputs from the single resulting `Vector[JsObject]`: `sampleRows =
sanitizeSampleRows(fields, rawRows)` (unchanged — it already internally truncates to `SampleRowLimit`, so
its wire output is bit-identical to today's, since Postgres returns rows in the same `ORDER BY row_index
ASC` order and the first 5 of a 500-row fetch equal the first 5 of a 5-row fetch), and `columnStats =
computeColumnStats(fields, rawRows)` (new, uses the full ≤500). **Why 500, not literally reusing 5**:
`nullRate`/`distinctCount`/`min`/`max`/`mean` over a 5-row sample would be statistically close to useless
for this ticket's own stated purpose ("pick a `sum`-able measure, avoid grouping by a high-cardinality
identifier") — 5 rows can't distinguish a low-cardinality categorical column from a UUID column. 500 is not
arbitrary: it matches the existing `DataSourceService.staticMaxRows = 500` precedent (the codebase's
established "reasonably-sized snapshot" constant). This is a deliberate interpretation of the ticket's
"same row bound as sampling": same bounding *mechanism* (the existing `listRows(limit, excludeKeys)`
SQL-tier `LIMIT`, zero new query paths, zero full scans) at a different, larger, still-constant value
chosen for statistical usefulness rather than reusing the literal number 5.
**Trade-off, stated explicitly, not hidden**: for a DataType with more than 500 rows, `distinctCount` and
`nullRate` are computed over a 500-row prefix, not the true full column — an approximation, not an exact
answer. This is still useful for the ticket's own use cases: a true low-cardinality categorical column
(status, tag) stays low-cardinality in any 500-row prefix; a high-cardinality identifier (near-unique per
row) reaches the `distinctCount` cap (D4) quickly within any 500-row prefix and reports `distinctCountCapped:
true` — the exact signal an agent needs to avoid grouping by it — even though the number itself isn't the
true global cardinality. `min`/`max` can differ from the true column extrema if outliers live outside the
first 500 rows (also stated as a known limitation, not silently swallowed).

**Round-1 skeptic finding, closed: the column-count side of the bound was false as originally written.**
`SampleColumnLimit` (40) was, and still is, applied only *inside* `sanitizeSampleRows`/`sanitizeSampleRows`'s
TS mirror — entirely after the SQL fetch returns. `DataTypeRowRepository.listRows`'s `excludeKeys` strips
only Content-category keys; there is no cap anywhere in the codebase (`RequestValidation.scala`,
`SchemaInferenceEngine.scala` both checked — CSV header/field count is unconstrained) on how many
Structured columns a DataType can declare. At `StatsRowLimit = 500` this is no longer a rounding error: an
uncapped wide DataType (e.g. 300 Structured columns, a plausible wide CSV export) would transfer `500 rows
× 300 columns × ~210 bytes ≈ 31.5 MB` from Postgres for that one DataType, multiplied across every
pipeline-output DataType in the workspace via `Future.traverse` — exactly the "bounded by construction, not
by hope" failure this ticket was told to avoid. **Fix: extend the existing `excludeKeys` mechanism itself
to also exclude Structured columns beyond the first `SampleColumnLimit` (40) in `dt.fields` declared
order — no new SQL construction, no new repository method, reusing the exact `data - k1 - k2 - ...`
dynamic-arity bind-param pattern HEL-372 already built and proved safe.**
**Round-3 skeptic finding, closed: `overflowStructuredFieldNames` needed one shared location and one
signature, not two inconsistent ones.** `DataTypeService`'s existing (currently empty) companion object
`object DataTypeService { ... }` (`DataTypeService.scala:174-178`) is the shared location: both
`WorkspaceContextService` (already depends on a `dataTypeService: DataTypeService` instance) and
`DataTypeRoutes` (already imports `DataTypeService`, `DataTypeRoutes.scala:10`, and holds a
`dataTypeService: DataTypeService` instance) can call `DataTypeService.overflowStructuredFieldNames(fields,
limit)` with zero new imports. One signature, one implementation, no duplication — unlike
`contentFieldNames`'s existing Scala/TS duplication (which exists only because Scala and TS share no
runtime, a different problem that doesn't apply to two same-language call sites):
```
def overflowStructuredFieldNames(fields: Vector[DataField], limit: Int): Set[String] =
  fields
    .filter(f => DataFieldType.fromString(f.dataType).map(DataFieldType.category).contains(FieldTypeCategory.Structured))
    .drop(limit)
    .map(_.name)
    .toSet
```
(A field whose `dataType` doesn't parse via `DataFieldType.fromString` is conservatively excluded from the
Structured set entirely — never counted toward the first `limit`, never in the overflow set either —
mirroring `WorkspaceContextService.fieldCategory`'s existing convention.)

- **Backend (in-process call)**: `WorkspaceContextService` computes `excludeKeys = contentFieldNames(dt.fields)
  ++ DataTypeService.overflowStructuredFieldNames(dt.fields, SampleColumnLimit)`. This is passed to the
  existing `dataTypeService.listRows(dt.id, user, limit = Some(StatsRowLimit), excludeKeys = excludeKeys)`
  call — no `DataTypeRowRepository`/SQL change at all, since `excludeKeys` is already an arbitrary
  `Set[String]` of top-level JSONB keys to strip at the query. The query now returns, per row, at most 40
  Structured columns' worth of data — a real SQL-tier bound, not a post-fetch discard.
  `sanitizeSampleRows`'s own `.take(SampleColumnLimit)` becomes redundant-but-harmless defense-in-depth for
  `sampleRows` (unchanged behavior). **`computeColumnStats` needs its own identical `.take(SampleColumnLimit)`
  truncation of its column *enumeration* — see D2's round-3 fix below; the SQL-tier `excludeKeys` bound
  alone is NOT sufficient for `computeColumnStats`, because its column list comes from `dt.fields` (the
  DataType's declared schema), not from the row data's key set.**
- **MCP (HTTP call via `GET /api/types/:id/rows`)**: the route's existing `excludeContentFields=true`
  branch already does a second owner-scoped `dataTypeService.findById` lookup to compute Content-field
  `excludeKeys` server-side (`DataTypeRoutes.scala:59-72`); the `!excludeContentFields` branch (lines 55-58)
  calls `listRows` directly with no fields lookup at all. This ticket adds one more optional query param,
  `maxStructuredColumns` (int), and — **round-2 skeptic finding, closed: `maxStructuredColumns` takes
  effect independently of `excludeContentFields`, not only when `excludeContentFields=true`** — changes the
  route's branch condition from `if (!excludeContentFields)` to `if (!excludeContentFields &&
  maxStructuredColumns.isEmpty)`. Inside the (now three-way-reachable) owner-scoped-lookup branch,
  `excludeKeys` is built as the union of two independently-optional parts: `(if (excludeContentFields)
  contentFieldNames(dt.fields) else Set.empty) ++ (maxStructuredColumns match { case Some(n) =>
  DataTypeService.overflowStructuredFieldNames(dt.fields, n); case None => Set.empty })`. Concretely:
  `maxStructuredColumns` alone (no `excludeContentFields`) excludes only the column-count overflow, leaving
  Content fields present; `excludeContentFields` alone (today's existing behavior, unchanged) excludes only
  Content fields; both together (the MCP's actual call shape) excludes both; neither preserves the plain
  unbounded-`listRows` path exactly as today. Omitting both params preserves today's exact behavior —
  additive, backward-compatible (the one existing frontend caller of `/rows`, `dataTypeService.ts`, passes
  neither and is unaffected). No new RLS surface either way: all three non-trivial combinations still sit
  behind the same owner-scoped `dataTypeService.findById`/`listRows`'s `findByIdOwned` choke point. `helio-mcp`'s
  `getDataTypeRows` gains a 4th optional arg forwarded as `?maxStructuredColumns=`; `buildWorkspaceContext`
  calls it with `40` (matching `SampleColumnLimit`), alongside `excludeContentFields=true` as today.
- **Worst case, now real, not asserted, at the per-DataType level**: `StatsRowLimit` (500) ×
  `SampleColumnLimit` (40) × the 200-char per-cell truncation floor used during aggregation (D3) — Postgres
  itself never returns more than 40 Structured columns per row regardless of how wide the DataType's true
  schema is. **Round-2 skeptic finding, closed: the per-*request* aggregate (fan-out across
  `Future.traverse(typesPage.items)`) was never computed — fixed below.**

**D1a — Per-request aggregate cost, computed and defended, not left implicit.** `assemble` fetches
`typesPage` via `Page.Default` (`limit = 200`, `backend/src/main/scala/com/helio/domain/pagination.scala`),
and `Future.traverse(typesPage.items)(toDataTypeEntry(_, user))` can therefore trigger up to 200
`listRows` calls — one per pipeline-output DataType — within a single `GET /api/workspace/context` request.
At D1's per-DataType worst case (~4.2 MB), the naive cumulative figure is `200 × 4.2 MB ≈ 840 MB` of row
data pulled from Postgres over the life of one request — two orders of magnitude above HEL-372's own
accepted `200 × 5 rows × 40 cols × ~210 bytes ≈ 8.4 MB` fan-out figure for the same shape of computation.
This is real and must be defended, not asserted away:
- **Concurrency is already throttled independently of DataType count.** `DataTypeRowRepository.listRows`
  runs via `ctx.withSystemContext(...)` — the **privileged** HikariCP pool (`application.conf:80`, a
  second, independently-configured pool from the primary app pool at line 49 — see `DbContext.scala`'s
  `withUserContext`/`withSystemContext` split), which is *also* `maximumPoolSize = 5` (round-3 skeptic
  finding: the design's first draft cited the wrong pool's line number; the conclusion is unaffected since
  both pools are independently capped at 5, but the citation now points to the pool this query actually
  uses). Slick queues any `DBIO` beyond 5 concurrently checked-out connections rather than opening more;
  `Future.traverse`'s 200-wide fan-out therefore executes as at most 5 `listRows` queries actually in
  flight at any instant, the rest waiting on the pool. **Peak concurrent memory for in-flight row data is
  bounded to `5 × 4.2 MB ≈ 21 MB`, independent of how many pipeline-output DataTypes the workspace has** —
  this is the number that matters for backend memory pressure/GC, not the cumulative 840 MB figure.
- **This bound is only true if the implementation doesn't retain fetched rows beyond the connection's
  lifetime — stated here as a binding requirement, not an assumption (human-reviewer condition attached to
  this decision, round 3).** The connection-pool argument above bounds *in-flight query* memory (how many
  `listRows` calls can be concurrently mid-fetch); it says nothing about *retained result* memory.
  `Future.traverse(typesPage.items)(toDataTypeEntry(_, user))` starts all (up to) 200 futures up front, and
  every completed future's result stays reachable on the heap until the whole `Future.traverse` completes —
  if `toDataTypeEntry` (or anything it calls) held each DataType's raw `rawRows: Vector[JsObject]` beyond
  computing `sampleRows`/`columnStats` from it, cumulative *retained* memory across the fan-out would
  approach the full 840 MB figure regardless of `maximumPoolSize`, because retention isn't gated by the
  connection pool at all — only the fetch itself is. **Requirement**: `toDataTypeEntry` MUST consume
  `rawRows` into `sampleRows` and `columnStats` and let it go out of scope within the same `Future.map`/
  `for`-comprehension step that produces the finished `WorkspaceContextDataType` — nothing outside that
  step (no accumulator, no intermediate collection built across the `Future.traverse`) may hold a reference
  to the raw ≤500-row fetch for any DataType once its own entry has been derived. What survives per
  DataType, once its future completes, is only the bounded `columnStats` map and the 5-row `sampleRows`
  vector — never the full `StatsRowLimit`-wide fetch. The executor must confirm this holds in the actual
  implementation (tasks.md 3.3), not merely assume the shared-fetch design implies it.
- **Cumulative egress (840 MB worst case) is real but not new in kind, only in magnitude, and is a request
  *latency* concern, not a memory-safety one.** The same "N DataTypes × per-DataType fetch, gated behind a
  5-connection pool" shape already exists today for `sampleRows` (HEL-372) — this ticket increases the
  per-DataType multiplier (5→500 rows) 100x, not the shape of the risk. A workspace with 200
  maximally-wide, maximally-populated pipeline-output DataTypes is an extreme, not a typical, case (most
  workspaces observed in this codebase's fixtures/DemoData have a handful of DataTypes); for that extreme
  case, `GET /api/workspace/context` will take materially longer (40 sequential batches of 5 queries) but
  will not exhaust backend memory, since the pool caps concurrent transfer regardless of total request
  duration.
- **Accepted, not silently absorbed**: this is a real, stated trade-off of D1's choice to raise
  `StatsRowLimit` — a workspace at the pathological end of DataType count/width trades request latency for
  materially more useful statistics. Reducing `StatsRowLimit` further to chase a smaller cumulative number
  would reopen D1's own "5 rows is statistically useless" problem without changing the *peak* memory bound
  (already independent of `StatsRowLimit` × DataType count, per the connection-pool argument above) — so
  there is no cost/benefit case for shrinking it further on this axis. The `Page.Default` 200-item fan-out
  width itself is the pre-existing, explicitly out-of-scope pagination limitation (HEL-377, per this
  ticket's carried findings) this design does not attempt to fix.

**D2 — `columnStats` covers Structured-category columns only; Content-category columns get no entry
(absence is the signal, not a boolean flag) — mirrors `sampleRows`'s existing exclusion for the identical
cost reason.** `excludeKeys` (D1) already means a Content column's value never arrives in `rawRows` at all
— `computeColumnStats` only ever sees Structured-category *values* by construction, so there's no in-app
value-filtering step to get wrong. An agent seeing a `columns[]` entry with no matching `columnStats` key
already has this convention established by `sampleRows`'s parallel exclusion; no new schema concept needed.

**Round-3 skeptic finding, closed: `computeColumnStats` must independently truncate its own column
*enumeration* to the first `SampleColumnLimit` (40) — D1's SQL-tier `excludeKeys` bound is necessary but
not sufficient here.** `computeColumnStats(fields: Vector[DataField], rawRows: Vector[JsObject])` decides
*which* columns to report on by iterating `fields` (i.e. `dt.fields`, the DataType's full declared schema —
unbounded, no cap exists anywhere on declared field count), not by iterating the keys actually present in
`rawRows`. D1's `excludeKeys` extension only stops Postgres from sending *values* for overflow columns —
it does nothing to stop `computeColumnStats` from still enumerating those overflow column *names* and
producing an entry for each (with `row.fields.get(name)` returning `None` on every row, since the SQL tier
already stripped the key — this looks like a "valid" all-null column, not a skip). For a 300-Structured-
column DataType, iterating `fields` unfiltered would produce 300 `columnStats` entries, not 40 — violating
the "at most 40" bound `sampleRows` already honors, both for the empty-snapshot case (D8) and the
non-empty case. **Fix**: `computeColumnStats` filters `fields` to Structured-category and takes the first
`SampleColumnLimit` (40) in declared order — `fields.filter(f => fieldCategory(f).contains(Structured)).take(SampleColumnLimit)`
— identical to `sanitizeSampleRows`'s existing column-projection step (`WorkspaceContextService.scala:224`)
— *before* folding over `rawRows`, on both the Scala and TS sides. This is an app-level truncation
independent of, and in addition to, D1's SQL-tier `excludeKeys` bound: D1 bounds what Postgres transfers
(the cost concern); this bounds what `computeColumnStats` enumerates and reports (the correctness/wire-shape
concern) — the two are complementary, not redundant. A DataType with more than 40 declared Structured
columns therefore has no `columnStats` entry at all for the overflow columns beyond the 40th (matching
`sampleRows`'s existing column-cap convention and `spec.md`'s "Wide DataType caps columnStats columns at
the database query itself" scenario).

**D3 — Per-value char cap during aggregation (200, matching `SampleCellCharLimit`) bounds
`computeColumnStats`'s worst case independent of any individual stored value's length; combined with D1's
now-real column-count bound, the worst case is fully constrained at the SQL tier, not just in-app.**
Structured-category types are `string`/`integer`/`float`/`boolean`/`timestamp` — no HEL-217 byte cap
applies to a `string`-typed field (only `string-body`/`binary-ref` carry the 10–20 MB ceiling), so nothing
stops a user from storing an arbitrarily long value in a `string`-typed Structured column. Before a value
is added to the distinct-value set or considered as an example value, its `compactPrint` is truncated at
200 chars with the same `"…[truncated]"` marker `sanitizeSampleRows` uses (D1's parent ticket) — bounding
memory during aggregation regardless of pathological input, at the accepted cost that two distinct values
sharing a >200-char prefix could collapse into one distinct bucket (rare for the short scalar values
Structured columns are meant to hold; the same trade-off `sampleRows` already accepts for its cell values).
Numeric parsing (D5) uses the raw, un-truncated value — numeric literals are never anywhere near 200 chars,
so truncation is moot there. **Worst case per DataType, now enforced at the SQL tier (D1), not merely
claimed**: 500 rows × 40 Structured columns (Postgres itself never returns more, per D1's `excludeKeys`
extension) × ~210 bytes/cell ≈ 4.2 MB transferred from Postgres, held transiently in Scala/TS to fold into
per-column accumulators — an order of magnitude below any single HEL-217 Content cell's own 10 MB ceiling,
not multiplied by row count, and independent of how many Structured columns the DataType actually declares.
This fetch already happens once per DataType in `assemble`'s `Future.traverse`, unchanged in shape from
today, just a larger constant plus the extended `excludeKeys` set.

**D4 — `distinctCount` is capped and reported as `(count: Int, capped: Boolean)`, not a
string-vs-number union field.** The ticket text says "capped, e.g. `100+`" — implemented as a numeric
`distinctCount` (≤ `DistinctCountCap = 100`) plus a sibling `distinctCountCapped: Boolean`, rather than a
field whose JSON type varies between number and string. This keeps `schemas/workspace-context.schema.json`
simple (a single `type: integer` field, no `oneOf`) and keeps the value machine-usable (an agent can
compare `distinctCount` numerically without a type check first); `distinctCountCapped: true` conveys
"at least 100, exact count not computed beyond the cap" exactly as the ticket's `"100+"` example intends.
Computed by counting distinct truncated (D3) values across all ≤500 fetched rows for that column, stopping
early once the running distinct-set size would exceed the cap (bounds memory/CPU on a pathologically
diverse 500-row column — a `Set` capped at 101 entries, never allowed to grow past that).

**D5 — Numeric stats (`min`/`max`/`mean`) only for columns declared `integer`/`float`; a value that fails
to parse as numeric is excluded from the numeric aggregate (not treated as null, not a computed 0).** CSV
sources read all columns as JSON strings at runtime regardless of declared schema type (carried finding —
verified against `SchemaInferenceEngine`/CSV connector behavior). `asNumeric(v: JsValue): Option[Double]`
handles both representations: `JsNumber` directly, `JsString(s)` via `s.trim.toDoubleOption`; any other
`JsValue` (boolean, object, array, or an unparseable string) returns `None` and that row's value is simply
excluded from `min`/`max`/`mean`'s running fold — it is NOT counted as null (`nullRate` only reflects
JSON `null`/absent-key, a distinct, orthogonal signal from "present but not numeric"), and it does NOT
silently become `0` (would corrupt `min`/`mean`). If zero values parse as numeric across the whole fetch
(all null, or all unparseable garbage on a mistyped column), `min`/`max`/`mean` are `None` (absent on the
wire, D7) rather than a fabricated number — same "no min/max" contract the ticket's all-null-column
acceptance criterion already describes, extended to the "declared numeric but holds garbage" case.
`mean` is rounded to 4 decimal places over the identical input order (`ORDER BY row_index ASC`), so both
sides compute the same IEEE-754 double sum — **see D5a below for the actual rounding technique in the
shipped code (revised post-ship from what this paragraph originally specified) and its cross-language
tie-break convention.**

**D5a — Post-ship revision (four final-gate skeptic rounds, all four findings genuinely real and fixed;
this addendum documents the ACTUAL shipped rounding/aggregation technique — the D5 paragraph above
describes the ORIGINAL design-gate-approved technique, which the shipped code no longer uses verbatim).**
The final-gate skeptic process caught two additional corruption paths beyond D5's own "declared numeric but
holds garbage" case, both in the *aggregation* step rather than the per-value `asNumeric` parse step D5
covers:

1. **Accumulator overflow.** `numericSum`'s running fold can itself overflow to `±Infinity` even when every
   individual value folded into it already passed `asNumeric` (e.g. two legitimately-finite `1e308` values
   summed). A finiteness guard is applied once, at the terminal boundary before a
   `WorkspaceContextColumnStats`/`ColumnStats` is constructed — covering `min`, `max`, and `mean` together
   in one place, not as three separate per-field checks — so a non-finite result from ANY source (a
   per-value parse, D5's `asNumeric`; or aggregation itself) is uniformly excluded (`None`/`undefined`), not
   fabricated.
2. **The rounding technique's OWN overflow surface.** D5's original `math.round(sum / count * 10000) /
   10000.0` technique has a second, independent overflow surface baked into the multiply-by-`10^scale` step:
   on the Scala side, `math.round(Double): Long` silently CLAMPS a non-finite (or merely
   `Long`-range-exceeding) input to `Long.MaxValue` instead of propagating non-finiteness — so a
   genuinely-huge-but-finite mean (one legitimate large outlier averaged with many ordinary rows) would
   silently fabricate a deceptively-finite, wildly-wrong value via this rounding step alone, even after
   finding (1) is fixed. **The shipped fix**: Scala replaced the technique with
   `BigDecimal(mean).setScale(4, RoundingMode.HALF_UP).toDouble` — no intermediate multiply, so no overflow
   surface, and a legitimately huge mean survives correctly rather than being fabricated or needlessly
   dropped. TS mirrors this (no native arbitrary-precision decimal type in the JS standard library) with a
   `roundToFourDecimals` helper that pre-checks whether `value * 10000` itself would overflow and falls back
   to the already-finite, correct, unrounded `value` if so — same outcome, different mechanism.
3. **Cross-language tie-break parity.** Before this revision, both sides used `math.round`/`Math.round`,
   which tie-break identically ("round half toward +Infinity" — `math.round(-0.5) == 0` in both languages).
   Switching only the Scala side to `BigDecimal`'s `RoundingMode.HALF_UP` ("round half AWAY FROM ZERO")
   introduced a real, adversarially-confirmed divergence at an EXACT binary tie at the 4th decimal place
   (e.g. a mean of exactly `-0.00005`: `HALF_UP` → `-0.0001`; the old TS tie-break → `-0`/`0`) — a regression
   against this ticket's own determinism promise (D6), caught by the final-gate skeptic process and fixed by
   aligning TS to Scala (not the reverse, since `HALF_UP`/`BigDecimal` is what closed finding 2 above): TS's
   `roundToFourDecimals` now breaks ties away from zero too, via an explicit `roundHalfAwayFromZero` wrapper
   (`scaled >= 0 ? Math.round(scaled) : -Math.round(-scaled)`) — the only place its behavior differs from
   plain `Math.round`, since every non-tie value already rounds identically under both conventions. Pinned
   by an identical `-0.00005 → -0.0001` regression test on both sides.

**Cross-language rounding parity is bounded, not absolute — stated explicitly rather than assumed.**
Aligning the tie-break convention (point 3 above) makes the two sides agree at every tie and at every
practically-reachable value, confirmed by direct probing (final-gate skeptic round 4) and pinned by a
shared regression test. But Scala and TS still use two *different rounding algorithms*, not one shared
implementation: Scala rounds the original value exactly via `BigDecimal.setScale` (arbitrary-precision
decimal arithmetic, no representation error); TS multiplies by `10^4`, rounds, and divides back down (with
the overflow pre-check from finding 2), which — unlike `BigDecimal` — can introduce IEEE-754 floating-point
representation error during the multiply/divide steps for an adversarially-constructed input. The two are
**not guaranteed bit-identical for every conceivable double**, only for the tie-break convention and for
every value either side's test suite or adversarial skeptic probing has actually reached. Closing this
residual gap completely would require either giving TS an exact-decimal arithmetic library (a new
dependency for a purely cosmetic parity gain) or reverting Scala's `BigDecimal.setScale` back to a
multiply-based technique (which would reintroduce finding 2's overflow-fabrication surface — unacceptable).
Deliberately not pursued for that reason. This sentence exists specifically so a future reader doesn't
repeat this ticket's own most costly pattern: a confident, unqualified determinism/finiteness claim in this
document that quietly stopped matching the shipped code (the original D5 paragraph's "identical technique
in both Scala and TS" text, and the once-false "`JsNumber` cannot represent `NaN`/`Infinity`" comment, both
did exactly this and each cost a full review round to catch).

**Accepted, not fixed, floating-point precision caveat**: the `Double`/JS-`number` `numericSum` accumulator
itself is standard IEEE-754 running-sum arithmetic (the same technique numpy/pandas use for a naive sum),
which accumulates a small relative rounding error at extreme magnitude/row-count combinations — e.g. 500
rows of exactly `1e300` produce a computed mean of `1.0000000000000088E300` rather than the mathematically
exact `1e300`, a relative error of ~8.8e-15 (identical on both Scala and TS, since both fold in the same
`ORDER BY row_index ASC` order). This is NOT the same failure class as findings 1-2 above (those produced a
wildly-wrong, order-of-magnitude-different fabricated number or a masked `None`/`null`; this stays in the
mathematically correct neighborhood, off by roughly 1 part in 10^14) and was deliberately NOT fixed with a
`BigDecimal`-accumulation representation change — accepted as a standard, expected characteristic of
`Double`-accumulator arithmetic for extreme-magnitude/high-row-count numeric columns, not a defect. Flagged
here so a future reviewer doesn't rediscover it and mistake it for one of the corruption bugs findings 1-2
describe.

**D6 — Determinism: fixed row order (already guaranteed by `ORDER BY row_index ASC`) + fixed
first-seen-order example-value capture + fixed mean rounding (D5) together make `computeColumnStats` a pure
function of its input `Vector[JsObject]`.** Example values are captured in an order-preserving structure
(`LinkedHashSet`-equivalent in Scala; a plain `Map`/array-with-membership-check in TS, since JS `Set`
iteration order is already insertion-order) — the first 5 *distinct*, truncated (D3), non-null values
encountered in row order, deduplicated on their truncated form. `distinctCount`/`nullRate` are simple
counts, order-independent by nature. No use of hash-based iteration order anywhere in the computation.

**D7 — Wire shape: `columnStats: Map[String, WorkspaceContextColumnStats]`, always present (empty object
for a source-companion DataType or one with no run snapshot) — matches the ticket's explicit "keyed by
column name," and mirrors `sampleRows`'s "always-present collection, never `Option`" shape (HEL-372 design.md
D6/`sanitizeSampleRows`'s spray-json lesson) so there is no `None`-omission risk on the top-level field
itself.** Per-column, `min`/`max`/`mean` (numeric-only, D5) ARE `Option[Double]` and therefore CAN be
individually absent on the wire (spray-json's `jsonFormatN` omits `None` rather than emitting `null`) — this
is the one place this ticket cannot avoid `Option`, because "no min/max for a non-numeric or all-garbage
column" is exactly the semantics the ticket's acceptance criteria ask for. Per the spray-json lesson (HEL-371
cost a full eval cycle on this exact mistake): `min`/`max`/`mean` are placed in `properties` typed
`["number", "null"]` and are **NOT** listed in `ColumnStats`'s `required` array in
`schemas/workspace-context.schema.json`; `nullRate`, `distinctCount`, `distinctCountCapped`, `exampleValues`
ARE always present and ARE required. Tests cover both the field-present (numeric column) and
field-absent (non-numeric / all-garbage column) branches on both the Scala and MCP sides — not
absent-only, which is exactly the gap that let the original HEL-371 bug through.

**D8 — RLS/ownership: no new surface — identical choke point to `sampleRows`; `computeColumnStats` runs for
EVERY successful fetch, including a zero-row one, not just non-empty ones.** `computeColumnStats` consumes
the exact same `rawRows: Vector[JsObject]` already fetched through `dataTypeService.listRows(dt.id, user,
...)`, which checks `dataTypeRepo.findByIdOwned` before ever touching `DataTypeRowRepository` (HEL-372
design.md D4). D1's `maxStructuredColumns` route param reuses the same route/service, gated by the same
`findByIdOwned` check the route's existing `excludeContentFields` branch already performs — no new
repository method, no new route (the existing `/rows` route gains one additive, optional param), no new
call site that could bypass ownership.

**Branch precision (round-1 skeptic finding, closed): `Left` (a `listRows` failure) and source-companion
(`dt.sourceId.isDefined`, no query ever made) degrade to `sampleRows = Vector.empty` /
`columnStats = Map.empty` together, from the single shared `Either` — but a *successful* `Right(rawRows)`
fetch, whether `rawRows` is empty (no run snapshot yet) or not, ALWAYS calls
`computeColumnStats(dt.fields, rawRows)`.** Folding `computeColumnStats` over an empty `rawRows` naturally
produces one entry per Structured-category column with `nullRate: 0` (explicitly defined as `0`, not
`NaN`/`0.0/0.0`, when that column's considered-row-count is `0` — the empty-snapshot case is exactly the
`totalRows == 0` case, and `0` is the "no evidence of nulls yet" reading, not an error state),
`distinctCount: 0`, `distinctCountCapped: false`, `exampleValues: []`, and no `min`/`max`/`mean` — matching
this ticket's own "DataType with no run snapshot still reports columnStats entries" acceptance scenario.
This is a different branch from `Left`/source-companion precisely because a snapshot query that *succeeds*
with zero rows still tells you the DataType's schema (`dt.fields`) — there is no reason to withhold
per-column entries just because no rows have landed yet.

**D9 — Sensitive data: `exampleValues` extends the same considered-and-accepted exposure HEL-372's D5
already established for `sampleRows`, now over a wider row window (≤500 rows instead of 5) — flagged
explicitly, not silently inherited.** `exampleValues` surfaces real, owner-scoped user data into an LLM
prompt, same class of exposure as `sampleRows`. What's different here: because stats are computed over up
to 500 rows rather than 5, `exampleValues` *can* draw from a larger slice of a column's true value space
than `sampleRows` ever could — still capped at 5 *output* values per column (D6), still Structured-category
only (D2), still truncated (D3), and still no new capability beyond what the user could already pull today
via the unbounded `GET /api/types/:id/rows` on their own data. The practical worst case is unchanged in
kind from HEL-372's D5 (a user's own data reaching their own agent call, gated by the PAT-scope model,
HEL-148) — this decision records that the row-window widened and that redaction/opt-out remains explicitly
out of scope (same as D5), not silently assumed.

**D10 — MCP mirrors D1's shared-fetch shape via one `getDataTypeRows(t.id, STATS_ROW_LIMIT, true,
SAMPLE_COLUMN_LIMIT)` call per pipeline-output DataType (replacing today's
`getDataTypeRows(t.id, SAMPLE_ROW_LIMIT, true)` call), feeding the same ≤500-row/≤40-column array into both
`sanitizeSampleRows` (unchanged, still self-limits to 5 rows) and a new `computeColumnStats`.** No new HTTP
call is added — the existing single fetch's `limit` query param value changes from 5 to 500, and a new
`maxStructuredColumns=40` param is added (D1), mirroring D1 exactly on the TS side.
`schemas/workspace-context.schema.json` remains the documented shared contract (HEL-372 design.md D6); each
side's tests independently assert their own numeric parsing, cap, and rounding behavior.

## Risks / Trade-offs

- [Risk] `distinctCount`/`nullRate`/`min`/`max` are approximations for any DataType whose true row count
  exceeds `StatsRowLimit` (500) — see D1.
  → Mitigation: explicitly documented in the schema description and this design doc; the ticket's own
  use cases (avoid a high-cardinality group-by, notice a mostly-null column) remain served by the
  approximation for the reasons D1 states. Not silently presented as exact.
- [Risk] Raising the shared fetch's `LIMIT` from 5 to 500 increases per-DataType payload fetched from
  Postgres for every `GET /api/workspace/context` call, even for a caller who only reads `sampleRows`.
  → Mitigation: still a single, bounded `LIMIT` query (D1/D3's ~4.2 MB worst case per DataType, transient,
  never held beyond the per-DataType `Future`) — not unbounded, not a second query, not proportional to a
  DataType's true row count. Acceptable given `columnStats` is now itself a first-class advertised field of
  the same response, not optional/opt-in per this ticket's acceptance criteria.
- [Risk] Per-*request* aggregate cost across a full `Page.Default`-width (200) DataType fan-out is up to
  `200 × 4.2 MB ≈ 840 MB` of cumulative row data pulled from Postgres over one request's duration (D1a) —
  two orders of magnitude above HEL-372's own accepted 8.4 MB figure for the same fan-out shape.
  → Mitigation (D1a): peak *concurrent* memory is independent of DataType count — HikariCP's
  `maximumPoolSize = 5` (`application.conf:49`) throttles actual in-flight `listRows` queries to 5 at a
  time regardless of `Future.traverse`'s 200-wide fan-out, bounding peak concurrent row-data memory to
  `5 × 4.2 MB ≈ 21 MB`. The 840 MB figure is a cumulative-egress/request-*latency* concern for the
  pathological (200 maximally-wide, maximally-populated DataTypes) case, not a memory-safety one — accepted
  as a stated trade-off, not silently absorbed. The underlying 200-item fan-out width itself is the
  pre-existing HEL-377 pagination limitation this ticket does not attempt to fix (carried finding).
- [Risk] A Structured `string` column with an unusually long individual value (D3) can have two distinct
  underlying values collapse into one `distinctCount`/`exampleValues` bucket if they share a >200-char
  prefix.
  → Mitigation: accepted, matches the existing `sampleRows` cell-truncation trade-off; Structured columns
  are meant to hold short scalars (identifiers, categories, numbers, timestamps) — long free text belongs
  in a Content-category field, which is excluded from stats entirely (D2).
- [Risk] `WorkspaceContextServiceSpec` is already large (431+ lines after HEL-372) before this ticket's new
  cases.
  → Mitigation: continue using the shared JSON-Schema-validation test-support helper HEL-372 already
  extracted (`backend/src/test/scala/com/helio/testsupport/`); add `computeColumnStats`-focused cases as a
  cohesive block rather than interleaving.
- [Risk] `DataTypeRoutes.scala`'s `/rows` route gains a second query-param-driven `excludeKeys`-widening
  behavior (`excludeContentFields` + now `maxStructuredColumns`) — two independent optional params
  composing into one server-side `excludeKeys` set increases the route's branching.
  → Mitigation: both params are independently optional and additive (D1); a route-level test pins the
  combined case (`excludeContentFields=true&maxStructuredColumns=40`) alongside the two params used
  individually, so the composition itself is covered, not just each param in isolation.
- [Risk] `mean`'s `Double`/JS-`number` running-sum accumulator carries the standard IEEE-754 floating-point
  precision drift any naive `Double` accumulator has, at extreme magnitude/row-count combinations (see D5a's
  "Accepted, not fixed" paragraph — e.g. ~8.8e-15 relative error for 500 rows of exactly `1e300`).
  → Mitigation: explicitly accepted, not silently absorbed — the human coordinator reviewed this directly
  during the final-gate arc and declined a `BigDecimal`-accumulation representation change (cost/complexity
  not justified by a drift that stays in the mathematically correct neighborhood and matches
  numpy/pandas-equivalent behavior, unlike the wildly-wrong fabricated values D5a's findings 1-2 fixed).
  Documented here so a future reviewer doesn't mistake it for an unfixed instance of those bugs.

## Migration Plan

Purely additive: one new always-present response field (`columnStats`, an object — never `Option`, no
spray-json omission risk at the top level), three new per-column optional numeric fields
(`min`/`max`/`mean`, correctly modeled as `Option`/nullable-but-not-required in the schema). One existing
internal constant renamed in effect (`SampleRowLimit` usage widened to `StatsRowLimit` for the shared
fetch) — no wire-visible change to `sampleRows`' own output. `GET /api/types/:id/rows` gains one new
optional query param (`maxStructuredColumns`, D1) — additive, backward-compatible, omitting it preserves
today's exact behavior for the one existing frontend caller. No database migration, no new repository
method, no existing endpoint's response *shape* altered (only an additional accepted, optional request
param on one route).

## Open Questions

None outstanding.
