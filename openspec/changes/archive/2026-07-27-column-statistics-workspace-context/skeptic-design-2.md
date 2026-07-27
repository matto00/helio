## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/workspace-context-assembly/spec.md`, `tasks.md` in
  full (fresh, cold read).
- Read `skeptic-design-1.md` (round-1 REFUTE) as a claim to verify, not as fact.
- Read `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` in full (current
  `toDataTypeEntry`, `sanitizeSampleRows`, `contentFieldNames`, `fieldCategory`, `SampleRowLimit`/
  `SampleColumnLimit`/`SampleCellCharLimit`, and `assemble`'s `Future.traverse(typesPage.items)(...)`).
- Read `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala`'s `listRows` SQL in
  full — confirmed `excludeKeys` is an arbitrary `Set[String]` chained as `data - k1::text - k2::text - ...`
  entirely at the SQL tier, so extending it costs zero new SQL/repository surface, as design.md D1 claims.
- Read `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala:49-75` (`/rows` route) — confirmed
  the current `excludeContentFields=true` branch is the only one doing an owner-scoped `findById` +
  server-side `excludeKeys` computation; the `!excludeContentFields` branch calls `listRows` directly with
  no fields lookup at all.
- Read `backend/src/main/scala/com/helio/services/DataTypeService.scala:37-50` (`listRows`'s
  `findByIdOwned` choke point — confirmed both the in-process and route paths funnel through it).
- Read `backend/src/main/scala/com/helio/domain/model.scala:447-503` (`FieldTypeCategory`/`DataFieldType`)
  — confirmed the 7-value closed set and `category` mapping design.md relies on.
- Read `backend/src/main/scala/com/helio/domain/pagination.scala:10-11` — confirmed `Page.Default =
  Page(offset = 0, limit = 200)`, i.e. `assemble`'s `Future.traverse(typesPage.items)` can fan out over up
  to 200 pipeline-output DataTypes in a single `GET /api/workspace/context` call.
- Read `backend/src/main/scala/com/helio/services/DataSourceService.scala:61` — confirmed
  `staticMaxRows = 500`, the precedent design.md D1 cites for `StatsRowLimit = 500`.
- Read `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` in full — confirmed
  `WorkspaceContextDataType` currently has 9 fields (`jsonFormat9`), so adding `columnStats` makes 10
  (well under spray-json's `jsonFormat22` ceiling); confirmed the established `Option`-omission convention
  (`sourceId`/`tag` typed `Option[String]`) the plan must keep following for `min`/`max`/`mean`.
- Read `helio-mcp/src/context.ts` in full and `helio-mcp/src/helioApi.ts`'s `getDataTypeRows` (lines
  223-233) — confirmed the current 3-arg call site (`getDataTypeRows(t.id, SAMPLE_ROW_LIMIT, true)`) always
  pairs `excludeContentFields=true`, and confirmed the TS mirror's structural parity with the Scala side.
- Read `schemas/workspace-context.schema.json` in full — confirmed `DataTypeEntry`'s existing
  `additionalProperties: false` / `required` shape and the established `Option`-omission documentation
  pattern the plan must extend for `ColumnStats`.
- Read `openspec/changes/archive/2026-07-27-sample-rows-datatype-context/design.md` (HEL-372) D1/D3/D4/D6 —
  confirmed the precedent this design explicitly builds on (SQL-tier key-stripping, RLS choke point, TS
  parity without a shared runtime).

**Round-1 CR1 (false cost-bound claim) — verified closed.** `design.md` D1 now extends `excludeKeys` to
`contentFieldNames(dt.fields) ++ overflowStructuredFieldNames(dt.fields)`, and I confirmed against the
actual `listRows` SQL that this is a genuine SQL-tier bound: the `jsonb - text` chain runs inside the query
itself, so Postgres computes and returns a row containing at most the first 40 Structured columns'
serialized values — not a superset that gets discarded in Scala/TS afterward. `tasks.md` 2.1's plan to
compute `overflowStructuredFieldNames` from the already-in-hand `dt.fields` (no extra query) and thread it
into the existing `listRows` call is consistent with the code. `tasks.md` 5.1 plans a wide-DataType
(>40 Structured columns) test that specifically asserts the SQL-tier mechanism, not just an app-level
discard. This closes CR1 as written.

**Round-1 CR2 (empty-fetch branch degrading to `Map.empty`, contradicting spec/tests) — verified closed.**
`design.md` D8 and `tasks.md` 2.4/3.3 now correctly distinguish three branches: `Left` and source-companion
(`dt.sourceId.isDefined`) → `columnStats = Map.empty`; every successful `Right(rawRows)`, empty or not, →
always calls `computeColumnStats(dt.fields, rawRows)`. `nullRate` is explicitly defined as `0` (not
`NaN`/division-by-zero) when a column's considered-row-count is `0`. This matches `spec.md`'s "DataType with
no run snapshot still reports columnStats entries" scenario and `tasks.md` 5.1/5.2's planned empty-snapshot
test. This closes CR2 as written.

### Verdict: REFUTE

Both round-1 findings are genuinely closed. However, a full fresh pass surfaced two further gaps — one on
the same cost-bounding axis the ticket brief calls "the single most important question," one an ambiguity
in the new route contract — that were not covered by round 1's narrower re-check.

### Change Requests

1. **The per-DataType cost bound is now real, but the per-*request* (aggregate, across the whole
   `Future.traverse(typesPage.items)` fan-out) cost is never computed or defended anywhere in `design.md`,
   and this is precisely the kind of undefended worst case the ticket brief and round-1 review both singled
   out ("bounded by construction, not by hope," "an explicit defended answer is required at the design gate,
   not a default").** `WorkspaceContextService.scala:86` fans `toDataTypeEntry` out via
   `Future.traverse(typesPage.items)`, and `typesPage` is fetched with `Page.Default` (`limit = 200`,
   `backend/src/main/scala/com/helio/domain/pagination.scala:11`) — i.e. up to 200 pipeline-output DataTypes
   can each trigger one `listRows` call in a single `GET /api/workspace/context` request. D3's own worst-case
   figure for one DataType is ~4.2 MB (`StatsRowLimit=500 × SampleColumnLimit=40 × ~210 bytes/cell`). Design
   never multiplies that by the DataType fan-out width: worst case across one request is now up to
   `200 × 4.2 MB ≈ 840 MB` of row data pulled from Postgres in one HTTP call — two orders of magnitude above
   HEL-372's own accepted worst case (`200 × 5 rows × 40 cols × ~210 bytes ≈ 8.4 MB`, the number round-1
   implicitly treated as fine). The Risks section ("Raising the shared fetch's LIMIT from 5 to 500...")
   states only the per-DataType figure and says "not multiplied by row count" — true, but it never addresses
   multiplication by DataType *count* within the same `assemble()` call, which is the actual axis that
   changed by 100x here (`StatsRowLimit` 5→500). **Required fix:** add an explicit Decision (or extend D1/D3)
   that computes and defends the aggregate worst case for a full `Page.Default`-width fan-out — either (a)
   accept the ~840 MB/request worst case explicitly with a stated rationale (e.g. HikariCP's
   `maximumPoolSize = 5`, confirmed in `backend/src/main/resources/application.conf:49`, throttles actual
   concurrent in-flight queries to 5 at a time, bounding peak concurrent memory to roughly
   `5 × 4.2 MB ≈ 21 MB` even though cumulative egress/latency across the full fan-out is much larger — state
   this reasoning if it's the intended defense, don't leave it unstated), or (b) add a real mitigation (e.g.
   bound `Future.traverse`'s concurrency, or reduce `StatsRowLimit` for wide workspaces, or note this as an
   accepted trade-off pending a future ticket) — but the design must not go to implementation with this
   number simply absent.

2. **The new `maxStructuredColumns` route param's interaction with the pre-existing `excludeContentFields`
   param is underspecified — a competent implementer could reasonably build a version where the param is
   silently a no-op in a valid, foreseeable combination, and `tasks.md` 5.3's test plan doesn't pin down
   which behavior is correct.** `DataTypeRoutes.scala:49-75`'s current structure is a hard binary: the
   `!excludeContentFields` branch (line 55-58) calls `listRows` directly with no fields lookup and no
   `excludeKeys` computation at all; only the `excludeContentFields=true` branch (line 59-72) does the
   owner-scoped `findById` + `excludeKeys` computation. `design.md` D1 and `tasks.md` 2.2 both describe
   `maxStructuredColumns` as extending only *"the existing `excludeContentFields=true` branch's"*
   `excludeKeys` computation — meaning, read literally, a caller who passes `?maxStructuredColumns=40`
   without `excludeContentFields=true` falls into the untouched `!excludeContentFields` branch and the param
   is silently ignored (no error, no effect). Today's one real caller (the MCP) always pairs the two
   (`getDataTypeRows(t.id, STATS_ROW_LIMIT, true, SAMPLE_COLUMN_LIMIT)` per D10), so this doesn't break the
   intended call site — but `tasks.md` 5.3 explicitly plans a route-level test for `maxStructuredColumns`
   "alone" (i.e., without `excludeContentFields=true`), and neither `design.md` nor `tasks.md` states what
   that test should assert. This is exactly the "ambiguity a competent implementer could read two ways" this
   review is charged to catch: one reading builds the param to be honored independently (requiring the route
   branch condition to change from `if (!excludeContentFields)` to something like
   `if (!excludeContentFields && maxStructuredColumns.isEmpty)`, i.e. real behavior change beyond what's
   currently planned); the other reading locks in "no-op when `excludeContentFields` is false or omitted" as
   intended behavior. Either is defensible, but the design must pick one and say so — right now it doesn't,
   and the executor is left to invent the answer, with `tasks.md`'s own test plan providing no ground truth
   to build or verify against. (No RLS/owner-check gap either way — both branches sit behind
   `dataTypeService.findById`/`listRows`'s `findByIdOwned`, so this is a behavior-ambiguity finding, not a
   security finding.) **Required fix:** state explicitly in `design.md` D1 what `maxStructuredColumns` alone
   (without `excludeContentFields=true`) does, update `DataTypeRoutes.scala`'s planned branch condition in
   `tasks.md` 2.2 to match, and revise `tasks.md` 5.3's "alone" case description to assert the chosen
   behavior rather than leaving it implicit.

### Non-blocking notes

- D4's `(distinctCount: Int, distinctCountCapped: Boolean)` shape and D5's `asNumeric`
  exclusion-not-null-not-zero handling remain sound (re-verified against the current spec scenarios).
- D7's spray-json `Option`-omission handling for `min`/`max`/`mean` is correctly specified against the
  verified current convention in `WorkspaceContextProtocol.scala`/`workspace-context.schema.json`, and both
  field-present/field-absent branches are planned in tests (5.1/5.4) — this remains the one place HEL-371's
  original gap is genuinely closed.
- D9's sensitive-data reasoning (wider row window, same PAT-scope-gated exposure class as HEL-372) is
  honestly stated, not silently inherited — no objection.
