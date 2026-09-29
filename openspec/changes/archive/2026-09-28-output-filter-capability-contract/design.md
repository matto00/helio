## Context

`GET /api/outputs/:id/rows` (`OutputRoutes.scala:91-115` -> `OutputService.rows` ->
`NodeSnapshotRepository.listRowsPaged`) already does server-side sort and "contains"/quick-term
filtering (HEL-1027, archived at `openspec/changes/archive/2026-09-28-server-side-sort-filter-output-rows/`,
design.md D1-D10). Ground truth re-verified directly against `main` (a4dbd83c) before writing this
design, not assumed from the ticket text:

- `OutputRowsQuery.scala` (73 lines, `services/pipelines/`) parses `SortParam`/`FilterParam` and
  resolves both against `Output.schema` (never row-0 inference) via `sortCastForColumn`, which
  requires the column to be present in `schema` with a **Structured** `DataFieldType`
  (`string`/`integer`/`float`/`boolean`/`timestamp` -- `DataFieldType.category`,
  `domain/model/model.scala:658-685`; the Content category is `string-body`/`binary-ref`).
- `NodeSnapshotRepository.scala` (305 lines) holds the SQL: `nodeFilterFragment` (shared WHERE
  fragment across `listRowsPaged`/`hasAnyRow`), `sortCastExpr` (wraps `data ->> $key` in
  `safe_numeric`/`safe_timestamptz` per D2), `quickTermFragment`/`filterWhereFragment` (bound
  `ILIKE` comparisons, D6), `orderByFragment` (D4's `row_index ASC` trailing tiebreaker).
- V111 (`safe_numeric` IMMUTABLE sql, `safe_timestamptz` STABLE plpgsql) already exists; **V112 is
  the next free migration number** (confirmed: `ls backend/.../db/migration | sort -V` tops out at
  V111).
- `capabilitiesAtNode` (`PipelineService.scala:1228`, `GET /api/pipelines/:id/capabilities`)
  is confirmed **node-scoped** (`pipelineId` + `stepId`) and **purely schema-projection-based**
  (`projectedSchemaAtNode` -> `buildNodeCapabilities`, no query against `node_snapshots` at all --
  it answers "what Output kinds/slots does this node's TYPE shape support," symbolically, often
  before any row has ever been materialized). See Decision 1 for why this ticket does not extend
  it.
- `PublicDashboardRoutes.scala:86-95` calls `outputRepo.findByIdInternal(outputId)` (not the
  sharing-aware `findById(id, user)`) then `nodeSnapshotRepo.listRowsPaged` directly, bypassing
  `OutputService.rows` entirely -- the ACL proof there is "this Output is bound to a panel already
  proven to belong to the public dashboard," not a user-identity check. Relevant to Decision 4.
- `OutputService.scala` is 418 lines, `NodeSnapshotRepository.scala` is 305 lines -- both already
  over CONTRIBUTING.md's 250-line soft budget (HEL-1187, filed as a follow-up of HEL-1027, still
  Backlog/unstarted). New logic in this ticket goes into a **new** file, not either of these two,
  per Decision 5.

## Decisions

### D1 — Capability contract lives on a new Output-scoped route, not `capabilitiesAtNode`

**Driver's own open question, resolved: the contract does NOT extend `capabilitiesAtNode`.**

`capabilitiesAtNode` answers a categorically different question at a categorically different
scope:

- **Scope mismatch.** It is keyed by `(pipelineId, stepId)` -- a NODE, evaluated against that
  node's *projected* schema, independent of which (if any) Output is bound there, and independent
  of whether the node has ever produced a row. A panel's filter controls are bound to one specific
  OUTPUT (`Output.schema` + its own `node_snapshots` data), which can differ from the node's raw
  projected shape once an Output's own `config` narrows/renames columns in the future, and,
  decisively, from...
- **Rigidity mismatch (the owner's actual ruling).** "The controls a panel offers must derive
  strictly from what THIS Output can actually be filtered by... two Outputs with the same column
  types may legitimately differ." `capabilitiesAtNode` is 100% symbolic (type-only) by design --
  it has no mechanism to consult ACTUAL row data, and every Output sharing the same projected
  schema at the same node would report byte-identical capabilities. Making `eq`/`in`
  dropdown-worthiness a function of the Output's own real cardinality (Decision 2) is *exactly*
  the differentiator the owner asked for, and it cannot be expressed inside a purely
  schema-projection-based endpoint without turning it into something else entirely.
- **Lifecycle mismatch.** `capabilitiesAtNode` is meant to be callable at panel-authoring time,
  before a pipeline has necessarily run (it never touches `node_snapshots`). A cardinality-aware
  filter contract is only meaningful once the Output HAS materialized rows -- querying
  `node_snapshots` for a never-run Output legitimately returns "no columns are eq/in-eligible yet,"
  which is correct behavior for a filter contract and wrong/confusing behavior to bolt onto a
  binding-time endpoint whose whole point is being usable pre-run.

**Decision: a new route, `GET /api/outputs/:id/filter-capabilities`, scoped to one Output (same
ACL surface as `/rows`: `outputRepo.findById(id, user)`).** This mirrors `/rows` itself -- both are
Output-scoped reads over the Output's own `node_snapshots`, not node-scoped, schema-only reads like
`capabilitiesAtNode`. See Decision 5 for where the code lives.

### D2 — Operator eligibility: type-based (free) vs. cardinality-based (data-dependent)

Two independent gates decide whether `<operator>` is offered for a column, both keyed off the
SAME per-column check (`OutputFilterCapability`, Decision 5) so the contract-listing endpoint and
the rows-endpoint's own request validation can never drift -- they call the identical function,
not two hand-maintained lists.

1. **Type-based (schema-only, zero DB cost beyond what `resolveSort`/`resolveFilter` already
   pay today):**
   - `contains` -- every Structured column (unchanged from HEL-1027; this is the existing
     `columns` map behavior, carried forward verbatim).
   - `gte`/`lte` -- only `IntegerType`, `FloatType`, `TimestampType` (range is meaningless on
     `string`/`boolean`).
   - `eq`/`in` -- gated by cardinality, below.
2. **Cardinality-based (the data-dependent, owner-ruled differentiator):** `eq`/`in` are granted
   together, only when the column's ACTUAL distinct-value count across the Output's own
   `node_snapshots` rows is `<= MaxDropdownCardinality` (`= 50`, a named constant on
   `OutputFilterCapability`, chosen because a dropdown with more than 50 options stops being a
   usable control -- not derived from any existing constant in this codebase, stated here as the
   deliberate new number it is). This check applies uniformly to EVERY Structured type, including
   `TimestampType`/numeric -- a pre-bucketed low-cardinality timestamp or an enum-like small-int
   status column legitimately earns `eq`/`in` under this rule exactly as a low-cardinality string
   column would; nothing hardcodes timestamp/numeric out of it. This is what makes two
   same-column-type Outputs differ: Output A's `region` (12 distinct values) gets `eq`/`in`;
   Output B's `notes` (thousands of distinct free-text values, same declared `string` type) does
   not.

Cardinality is computed as `SELECT COUNT(*) FROM (SELECT 1 FROM node_snapshots WHERE <node filter>
AND data ->> $col IS NOT NULL GROUP BY data ->> $col LIMIT $capPlus1) t`.

**Revision (skeptic-design-1.md, change request 1) -- the LIMIT does NOT bound the scan work,
verified false on a live Postgres 18.4 instance.** A round-1 draft of this decision claimed the
`LIMIT $capPlus1` "bounds the WORK to `capPlus1` distinct groups, not the full distinct set." That
is wrong: with no index on `data ->> $col` (which this design deliberately does not add -- see D7),
Postgres has no ordered access path to feed the `GROUP BY`, so the planner picks a `HashAggregate`
fed by a `Seq Scan` -- a blocking operator that must consume the ENTIRE matching row set to build
its hash table before it can emit even one grouped row, let alone stop at the `LIMIT`. Reproduced
directly (200k-row seeded table, no index): `EXPLAIN ANALYZE` showed `actual rows=200000` on the
feeding `Seq Scan` regardless of the `LIMIT`; adding a functional index dropped that to `actual
rows=2001` (early-stopped) and cut execution time 70x. The `LIMIT` only trims the OUTPUT of the
cardinality check, never the WORK -- this query is a full sequential scan of the Output's own
matching `node_snapshots` rows, once per column checked. See D7 for the corrected cost model and
the resulting (unchanged) "no new index" decision, now argued from the true cost rather than a
false one.

The column name is a bound parameter (`data ->> $col`) exactly like every other filter/sort
column reference in this codebase (D6 precedent) -- **`OutputFilterCapability`'s own caller is
what makes this safe**: cardinality is only ever computed for columns drawn from the Output's OWN
`schema` (Decision 5's contract-build path) or a column ALREADY validated present-and-Structured
(the rows-endpoint's on-demand path, Decision 3) -- a raw, unvalidated user-supplied column string
never reaches this query.

### D3 — Rows-endpoint request shape: `ops[]`, cardinality checked on-demand, never eagerly

Extend `filter`'s existing JSON shape (currently `{"quick"?: string, "columns"?: {[col]:
string}}`) with a new optional key, keeping `quick`/`columns` byte-for-byte unchanged (HEL-1027's
own guarantee, preserved):

```json
{
  "quick": "acme",
  "columns": { "notes": "refund" },
  "ops": [
    { "column": "revenue", "op": "gte", "value": "1000" },
    { "column": "signup_date", "op": "lte", "value": "2026-06-30" },
    { "column": "region", "op": "in", "values": ["US", "EU"] }
  ]
}
```

- Every `ops[]` value is a JSON **string**, even for a numeric/timestamp column -- matching the
  existing `columns` map's own convention (`Map[String, String]`) of treating every filter term as
  text, and letting the SAME `safe_numeric`/`safe_timestamptz` cast (D2 of HEL-1027's design,
  reused verbatim, never re-implemented) parse it on the SQL side. This means a malformed `eq`/
  `gte`/`lte` value degrades to "no match" (comparing against `NULL`), never a `500` -- the exact
  guarantee HEL-1027's D2 already established for sort, extended here to filter values on both
  sides of the comparison (`safe_numeric(data ->> $col) = safe_numeric($value)`, not
  `data ->> $col = $value::numeric` -- the latter would reintroduce D2's original one-bad-row-500
  bug on the VALUE side even though the column side is guarded).
- `in`'s `values` array is capped at **100** entries (a stated, arbitrary-but-explicit bound,
  mirroring `Page.MaxLimit`'s own precedent of a named ceiling rather than an unbounded list) --
  over the cap is `400`, naming the column.
- **`in`'s value-side cast, per element (skeptic-design-1.md, change request 2 -- omitted from a
  round-1 draft of this decision, which spelled out `eq`/`gte`/`lte`'s value-side cast but left
  `in` unspecified).** D2 grants `eq`/`in` together off the identical cardinality gate for EVERY
  Structured type, including numeric/timestamp (an enum-like small-int status column or a
  pre-bucketed low-cardinality timestamp), so a real `in` filter against a numeric/timestamp column
  is in scope, not hypothetical. Each element of `values` is cast with the SAME per-column cast as
  `eq`, individually: for a numeric/timestamp column, `safe_numeric(data ->> $col) IN
  (safe_numeric($v1), safe_numeric($v2), ...)` / `safe_timestamptz(...)` respectively -- never a
  raw `data ->> $col IN ($v1, $v2, ...)` compared as text, which would silently fail to match
  numerically-equal-but-differently-formatted values (e.g. `"1000"` vs `"1000.0"`) and would
  reintroduce HEL-1027 D2's original one-bad-row-500 bug on this specific path if a future edit
  ever swapped in a raw `::numeric`/`::timestamptz` cast instead. For a `string`/`boolean` column,
  `in` stays plain bound text: `(data ->> $col) IN ($v1, $v2, ...)` (no cast needed or possible, and
  none of `safe_numeric`/`safe_timestamptz` apply to `AsText`-cast columns, matching `eq`'s existing
  text-compare treatment for those two types). A malformed VALUE within an `in` list -- e.g. one
  non-numeric string among otherwise-valid list entries -- casts to `NULL` for that element only
  (never matches any row's non-null cast value) and does not fail the request; the other elements
  in the same list are unaffected. See tasks.md 7.5 for the required test.
- Multiple `ops[]` entries may target the SAME column (e.g. `gte` + `lte` together express a
  range) -- ANDed, exactly like `columns`/`quick` are ANDed with each other today. Multiple
  entries with the SAME column AND SAME op are rejected as `400` (ambiguous; the ticket's own date-
  range example only ever needs one `gte` and one `lte` per column).
- **Validation order in `OutputRowsQuery.resolveFilter`** (now `Future`-returning -- it needs to
  reach the repository for the cardinality check on `eq`/`in`; `resolveSort` is unaffected and
  stays synchronous):
  1. Column present in `schema` with a Structured type? No -> `400 "column not filterable: '<col>'"`
     (unchanged D3-of-HEL-1027 wording/behavior).
  2. Op valid for that column's TYPE (D2's static gate)? No -> `400` naming column+op (e.g. `gte`
     on a `string` column).
  3. Op is `eq`/`in`? Run `OutputFilterCapability`'s cardinality check for THAT column ONLY (not
     the whole schema) -- over cap -> `400` naming column+op. **This is the one on-demand,
     per-request DB cost this ticket adds to the rows endpoint**, and it is bounded to however
     many distinct columns the CALLER actually named with `eq`/`in` in that one request (typically
     0-3 for a real panel's controls), never the Output's full column count -- see Decision 6 for
     why eagerly checking every column on every `/rows` call would be the wrong trade instead.
- **Why the rows endpoint re-checks cardinality at all, rather than trusting a client that already
  saw the contract:** the ticket's own AC requires "a request using an operator the contract
  doesn't declare is rejected with a defined 400 (test both directions: the contract and the
  endpoint can't drift)" -- a stale client (schema/data changed after the panel loaded, same class
  of race D3-of-HEL-1027 already documents for sort/filter) must not be able to silently exceed
  what the current contract actually allows.

### D4 — Distinct-values read: `GET /api/outputs/:id/distinct-values?column=`

- ACL: identical to `/rows` (`outputRepo.findById(id, user)`) -- an Output's distinct values are
  exactly as visible as the Output's rows themselves, no separate check invented.
- Gate: the named `column` must resolve to `eq`/`in`-eligible under the SAME
  `OutputFilterCapability` check `/filter-capabilities` and the rows endpoint's `ops` validation
  both use (Decision 2) -- a column that is Content-category, absent from schema, or over the
  cardinality cap is `400`, naming the column. This is the literal "refused for columns without
  `eq`/`in`" AC, implemented as one shared gate, not a fourth hand-copied eligibility check.
- Query: `SELECT data ->> $col AS value, COUNT(*) AS freq FROM node_snapshots WHERE <node filter>
  AND data ->> $col IS NOT NULL GROUP BY value ORDER BY freq DESC LIMIT $MaxDropdownCardinality`
  -- same node-scoping fragment as every other query here, same bound-parameter column reference,
  capped and ordered by frequency exactly as the owner ruled ("capped top-N-by-frequency").
- Response: `{"column": "region", "values": [{"value": "US", "count": 120}, ...]}`.
- **Public/anonymous variant: explicitly deferred to HEL-1190, not built here.** HEL-1188 is
  scoped as backend foundation with "any UI... out of scope," and the epic's own leaf order puts
  the viewer control bar (which is what actually needs anonymous dropdown options) at HEL-1190,
  after the author-facing config leaf (HEL-1189). Shipping an authenticated-only route now,
  without also standing up the anonymous route, does not strand HEL-1190: `OutputFilterCapability`/
  the distinct-values query (Decision 5) are written as plain functions taking an already-resolved
  `Output` (not an `AuthenticatedUser`), exactly mirroring how `PublicDashboardRoutes.scala:86-95`
  already calls `nodeSnapshotRepo.listRowsPaged` directly against an `Output` resolved via
  `outputRepo.findByIdInternal` (a DIFFERENT ACL proof -- "this Output is bound to a panel already
  proven to belong to this public dashboard" -- not a user-identity check at all). HEL-1190 adds
  its own thin route in `PublicDashboardRoutes` calling the exact same functions with that same
  existing ACL pattern; zero rework of this ticket's logic. Stating this now rather than silently
  leaving it unaddressed is the "decide and justify" the ticket asks for.

### D5 — New file, not a further extension of `OutputService`/`NodeSnapshotRepository`

New object `backend/src/main/scala/com/helio/services/pipelines/OutputFilterCapability.scala`,
sibling to `OutputRowsQuery.scala` (same package, same "kept out of `OutputService.scala` to
respect the file-size budget" rationale that object's own header already states) holds:

- `sealed trait Operator` (`Contains`, `Eq`, `In`, `Gte`, `Lte`) + wire-string mapping.
- `def staticOperatorsFor(fieldType: DataFieldType): Set[Operator]` -- D2's type-only gate, pure,
  no DB.
- `def cardinalityEligible(count: Int, cap: Int = MaxDropdownCardinality): Boolean = count <= cap`.
- `def buildContract(output: Output, nodeSnapshotRepo: NodeSnapshotRepository)(implicit ec):
  Future[FilterCapabilityContract]` -- iterates `output.schema`'s Structured columns, computes
  `staticOperatorsFor` (free) plus, for every column, one `distinctValueCountCapped` call (new
  `NodeSnapshotRepository` method, Decision 6) to decide `eq`/`in`; assembles the response,
  omitting any column left with an empty operator set (Content-category/absent columns never
  appear at all -- matches "not filterable" being absence, not an empty-array entry).
- `def eqInEligibleColumn(output: Output, nodeSnapshotRepo: NodeSnapshotRepository, column:
  String)(implicit ec): Future[Either[ServiceError, Unit]]` -- the ONE-column on-demand check
  `OutputRowsQuery.resolveFilter`'s `eq`/`in` branch and the distinct-values route both call,
  instead of computing the whole contract just to check one column.

`OutputService.scala`/`NodeSnapshotRepository.scala` gain only their existing call-through methods
(`OutputService.filterCapabilities`/`distinctValues`, `NodeSnapshotRepository.distinctValueCountCapped`/
`topDistinctValues`) -- a handful of lines each, not the bulk of the new logic, consistent with not
growing either file materially ahead of HEL-1187's planned split (Context, above).

### D6 — Why cardinality is checked on-demand for `/rows`, eagerly for `/filter-capabilities`

`/filter-capabilities` is called once per panel load/config-open (an author opening a control
picker, or -- once HEL-1190 lands -- a viewer's dashboard load). `/rows` is the HOT path (every
pagination/sort/filter interaction re-fetches it), so this ticket deliberately does NOT run the
full per-column cardinality sweep there -- only the 0-3 columns a specific request actually names
with `eq`/`in` pay the extra query, and a request using no `eq`/`in` at all (the common case:
`contains`, `gte`/`lte` range, or no filter) pays ZERO additional queries beyond HEL-1027's
existing shape. This asymmetry is deliberate, not an oversight -- eagerly running the full contract
check on every `/rows` call would multiply this ticket's own hot-path cost by the Output's column
count for no benefit, since the SAME contract is already available (and cacheable client-side)
from the one-time `/filter-capabilities` call. **This ticket's `/filter-capabilities` cost is real,
not free** -- see D7's corrected cost model, which this decision's own frequency claim ("called
once per... viewer's dashboard load") is precisely why D7 treats it as a per-dashboard-load cost,
not a negligible one.

### D7 — Performance & indexing (ticket AC: "state explicitly whether an index is needed")

**Revision (skeptic-design-1.md, change request 1) -- corrected cost model, live-Postgres-verified,
replacing a round-1 draft that incorrectly claimed the `LIMIT` bounded the scan work (see D2's own
revision note for the reproduction).** `distinctValueCountCapped`'s `GROUP BY (data ->> $col)`, with
no index on the extracted JSON key, forces Postgres into a `HashAggregate` fed by a `Seq Scan` that
must consume the Output's **entire** matching `node_snapshots` row set before emitting anything --
the `LIMIT` trims OUTPUT rows, not scanned rows. `topDistinctValues` (the actual distinct-values
read, `ORDER BY freq DESC LIMIT`) has the identical shape and the identical cost. So the true cost
is:

- **`/rows`' on-demand `eq`/`in` check (D3/D6):** one full Output-row scan **per column actually
  named** with `eq`/`in` in a given request -- typically 0-3 columns for a real panel's controls,
  same per-query order of cost as the sort/filter scan HEL-1027's own D9 already accepts for every
  `/rows` call, just possibly a small multiple of it (one scan per named eq/in column, not one).
- **`/filter-capabilities` (D5's `buildContract`):** one full Output-row scan **per Structured
  column in the Output's schema** -- genuinely `O(columns x Output-row-count)`, not the bounded
  per-column cost a round-1 draft of this decision claimed. At this product's stated scale (~10k
  rows, dozens of columns, D9's own worked example), that is dozens of ~10k-row sequential scans --
  each comparable in cost to one `/rows` sort/filter query, so on the order of tens of milliseconds
  each, low-single-digit-seconds total in the realistic worst case. This is the ticket's own
  required AC (state whether an index is needed) answered honestly, not glossed over.

**Why "no new index" still stands, now argued from the true cost rather than a false one:** a
functional index (`CREATE INDEX ... ((data ->> 'col')))`) cannot be created ahead of time for this
query the way D9 already established for sort/filter -- the column is caller-chosen and per-Output,
with no fixed, enumerable set to index against. Pre-creating an index per column at Output-schema
time is a materially different feature (dynamic per-Output index management) explicitly out of
scope here. **D6's own stated future trigger -- `/filter-capabilities` being called on every
dashboard load once HEL-1190 lands, not just at panel-authoring time -- is weighed explicitly, not
glossed over:** at that point this cost recurs on every viewer page load, which is a real, near-term
concern this ticket does not resolve. **Escalation path, stated rather than silently deferred (two
tiers, ordered by when they'd actually be needed):**
1. **Near-term (once HEL-1190 makes this a per-dashboard-load cost):** cache the built contract
   server-side per Output, keyed by a cheap data-version signal already available on `Output`
   (e.g. its bound node's last successful run timestamp, mirroring `materializedFor`'s own existing
   use of `pipelineRunRepo.latestSuccessfulCompletedAtInternal`), invalidated whenever that
   timestamp advances. Not built in this ticket -- HEL-1188 is scoped to the backend contract
   itself, and a caching layer is properly HEL-1190's concern once the actual per-load call
   frequency is measured, not guessed at here.
2. **Longer-term (if row/column counts grow well beyond today's):** the same fix D9 already names
   for sort/filter -- a materialized, indexed columnar projection kept in sync with
   `node_snapshots` -- explicitly out of scope for both this ticket and tier 1 above.

Neither tier is a gap pretended away: tier 1 is the ticket's own honest answer to "this will be
called frequently soon," named so HEL-1190 doesn't have to rediscover the need from scratch.

### D8 — Security (mirrors HEL-1027 D6 exactly, extended to the new surfaces)

Every user-supplied value in this ticket (an `ops[]` column name, op, value/values; a
`distinct-values` `column` query param) is a bound SQL parameter, never interpolated -- same
`data ->> $key` pattern, same `safe_numeric`/`safe_timestamptz` reuse, same closed-enum validation
for `op` (one of exactly `eq`/`in`/`gte`/`lte`, checked in Scala before it can reach SQL, mirroring
`sort`'s direction check) as HEL-1027 already established for `sort`/`columns`. Execution MUST
include a hostile-column-name test against BOTH new routes (`filter-capabilities`'s implicit
schema-only enumeration needs no such test -- it never takes a column name as input -- but
`distinct-values`'s `column` param and `/rows`' `ops[].column` both do) reusing HEL-1027's own
red-first pattern: a payload like `'; DROP TABLE node_snapshots; --` is rejected as `400`
(not-eligible-column), with no SQL error and no data leakage.

### D9 — Spec amendment (ticket scope item 4)

`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` section 3 currently
describes a "Refetch vs. Recompute" split with `{{var}}` pipeline-parameter re-runs. Per the
2026-09-29 owner re-scope (recorded on HEL-915, verified directly against Linear during Setup, not
merely asserted from the ticket text), the amendment restates: per-panel controls are
**server-refetch only**; "Recompute" is dropped for v0.8 entirely (not deferred -- removed from
this milestone's scope); dashboard-wide variables move to v0.9 (HEL-1192). The amendment records
this as a historical restatement (what the section now says), not a rewrite erasing that the
original design existed -- consistent with how the epic's own re-scope comment states "where they
conflict, the comment wins" rather than deleting the original epic body.

### D10 — Non-goals (unchanged from proposal.md)

Any frontend/UI wiring; `{{var}}` recompute (dropped); dashboard-wide variables (v0.9); a public/
anonymous route for the two new endpoints (D4, deferred to HEL-1190); a materialized/cached
cardinality projection (D7's stated escalation path, not this ticket's scope).
