## Skeptic Report — design gate (round 3)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/workspace-context-assembly/spec.md`, `tasks.md` in
  full (fresh, cold read), plus `skeptic-design-1.md` and `skeptic-design-2.md` as claims, not fact.
- `backend/src/main/resources/application.conf`: confirmed `maximumPoolSize = 5` at line 49 (app pool)
  with the cited Cloud Run rationale comment (lines 34-47) — **but** confirmed a *second*,
  independently-configured `maximumPoolSize = 5` at line 80 for the `privileged` pool.
- `backend/src/main/scala/com/helio/infrastructure/DbContext.scala`: confirmed `withUserContext` (app
  pool, RLS-evaluated) vs. `withSystemContext` (privileged pool, BYPASSRLS) are two *separate* Hikari
  pools.
- `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala`: confirmed `listRows` runs
  via `ctx.withSystemContext(...)` — i.e. the **privileged** pool (application.conf:80), not the pool at
  line 49 that D1a's text cites. Both are numerically `5`, so D1a's *conclusion* (peak concurrent ≈ 21MB)
  survives, but the citation is to the wrong pool's config line.
- `backend/src/main/scala/com/helio/domain/pagination.scala`: confirmed `Page.Default = Page(offset = 0,
  limit = 200)`.
- `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala`: read `assemble`,
  `toDataTypeEntry`, `sanitizeSampleRows`, `contentFieldNames`, `fieldCategory` in full — confirmed
  `sanitizeSampleRows` internally does `fields.filter(f => fieldCategory(f).contains(Structured)).take(SampleColumnLimit)`
  (line 224) before folding over rows — i.e. today's only column-count truncation happens *inside the
  app-level column-selection step*, not by trusting the row data's key set.
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` (lines 1-100+): confirmed the current
  `/rows` route's binary branch (`if (!excludeContentFields) ... else { findById; inline excludeKeys
  build; listRows }`) that `design.md`'s round-2 fix condition (`if (!excludeContentFields &&
  maxStructuredColumns.isEmpty)`) modifies — the plan is consistent with the actual current code.
- `backend/src/main/scala/com/helio/domain/model.scala:447-503`: confirmed the 7-value `DataFieldType`
  closed set and `Structured`/`Content` category mapping.
- `backend/src/main/scala/com/helio/services/DataTypeService.scala`: confirmed `findByIdOwned` choke point
  on both `findById` and `listRows`.
- `backend/src/main/scala/com/helio/services/DataSourceService.scala:61-79`: confirmed `staticMaxRows =
  500` and the 10-20MB Content byte ceilings cited by D1/D3.
- `helio-mcp/src/context.ts` and `helio-mcp/src/helioApi.ts` (`getDataTypeRows`, lines 223-233): confirmed
  current shape matches what D1/D10/tasks 2.3/4.1 plan to extend.
- `schemas/workspace-context.schema.json` and `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala`:
  confirmed the established `Option`-omission convention (`sourceId`, `tag`, `validationError`, etc. — all
  `["T","null"]`, all absent from `required`) that the `min`/`max`/`mean` plan correctly follows; confirmed
  `WorkspaceContextDataType` is currently `jsonFormat9` (room to grow to 10, well under spray-json's
  `jsonFormat22` ceiling).

Round 1's two findings and round 2's two findings all check out as genuinely closed against the current
`design.md`/`tasks.md` text, and D1a's core concurrency-bound *conclusion* is sound (just mis-cited —
noted below, non-blocking).

### Verdict: REFUTE

A full fresh pass — specifically tracing how `computeColumnStats` is actually supposed to decide *which
column names to enumerate* — surfaced a new, concrete defect that contradicts the design's own planned
test and the spec's own explicit scenario.

### Change Requests

1. **`computeColumnStats`'s planned "no extra column-count cap needed" is false, and directly contradicts
   `tasks.md` 5.1's own planned test and `spec.md`'s "Wide DataType caps columnStats columns at the
   database query itself" scenario.** `tasks.md` 3.1 states: *"Structured-category columns only
   (design.md D2 — already guaranteed by 2.1's `excludeKeys`, no extra column-count cap needed inside this
   function)"* and separately *"Must produce one entry per Structured-category column even when `rawRows`
   is empty."* `tasks.md` 3.3 confirms the call site passes the **full, untruncated** `dt.fields`:
   `computeColumnStats(dt.fields, rawRows)`.
   Follow the actual data flow: 2.1's `excludeKeys` extension only strips overflow-column *values* out of
   the JSONB rows Postgres returns — it does nothing to bound how many field *names*
   `computeColumnStats` walks, because that enumeration comes from the `fields: Vector[DataField]`
   parameter (`dt.fields`, unbounded — confirmed no cap exists anywhere on declared field count, per round
   1's own grep of `RequestValidation.scala`/`SchemaInferenceEngine.scala`), not from the row data.
   Concretely, for a DataType with 300 declared Structured columns:
   - **Empty-snapshot case (`rawRows = []`)**: per 3.1's own "must produce one entry... even when empty"
     instruction, iterating `fields.filter(Structured)` with no `.take(40)` produces **300** entries, not
     40 — violating the "at most 40" invariant even before any row data exists.
   - **Non-empty, wide-DataType case (`tasks.md` 5.1's actual planned test)**: for each of the 260
     overflow columns, `row.fields.get(name)` returns `None` on *every* row (the key was stripped at the
     SQL tier by 2.1's fix) — so instead of "no entry," `computeColumnStats` produces a **valid-looking
     entry** (`nullRate: 1.0`, `distinctCount: 0`, `exampleValues: []`) for all 300 columns, not 40. This
     is the exact test `tasks.md` 5.1 plans to write ("wide DataType (>40 Structured columns) reports no
     `columnStats` entry for overflow columns") — as currently specified, the design's own stated
     implementation approach would fail its own planned test.
   `sanitizeSampleRows` already solves this correctly today (`.filter(Structured).take(SampleColumnLimit)`,
   line 224 of `WorkspaceContextService.scala`) — `computeColumnStats` needs the identical app-level
   truncation of its column enumeration (independent of, and in addition to, 2.1's SQL-tier `excludeKeys`).
   **Required fix:** revise `design.md` D2 and `tasks.md` 3.1/4.2 to state explicitly that
   `computeColumnStats` truncates its own Structured-field enumeration to the first `SampleColumnLimit`
   (40, matching `SampleColumnLimit`/`SAMPLE_COLUMN_LIMIT`) in declared order — e.g.
   `fields.filter(f => fieldCategory(f).contains(Structured)).take(SampleColumnLimit)` before folding,
   mirroring `sanitizeSampleRows` exactly — on **both** the Scala (3.1) and TS (4.2) sides, and remove the
   false "no extra column-count cap needed" claim.

2. **`overflowStructuredFieldNames`'s two call sites imply two different signatures with no stated shared
   location, leaving the executor to invent the answer.** `tasks.md` 2.1 scopes creation of
   `overflowStructuredFieldNames(fields: Vector[DataField]): Set[String]` to `WorkspaceContextService.scala`
   (single-arg, implicitly bound to that service's own `SampleColumnLimit = 40`). `tasks.md` 2.2 (and
   `design.md` D1's route bullet) then calls `overflowStructuredFieldNames(dt.fields, n)` — a **different,
   two-arg** signature — from inside `DataTypeRoutes.scala`, an unrelated class with no dependency on
   `WorkspaceContextService`. Nothing in `design.md`/`tasks.md` states where this function actually lives
   such that it's reachable from both files, nor whether the route's version is a shared public/companion-
   object utility or an independently duplicated implementation (the codebase's existing precedent for
   `contentFieldNames`-equivalent logic is duplication: `WorkspaceContextService.contentFieldNames` is
   private, while `DataTypeRoutes.scala`'s existing `excludeContentFields` branch inlines the identical
   Content-filter logic itself rather than calling it). A competent implementer following `tasks.md`
   literally will hit a compile error in `DataTypeRoutes.scala` (`overflowStructuredFieldNames` not in
   scope) with no design guidance on how to resolve it. **Required fix:** state explicitly in
   `design.md`/`tasks.md` 2.1/2.2 whether `overflowStructuredFieldNames` is (a) extracted to a shared,
   accessible location (e.g. a companion object or a method on `DataTypeService`) callable from both
   `WorkspaceContextService.scala` and `DataTypeRoutes.scala`, or (b) independently reimplemented inline in
   `DataTypeRoutes.scala` matching the existing `contentFieldNames`-duplication precedent — and make the
   two task items' function signatures consistent with whichever choice is made.

### Non-blocking notes

- D1a's citation ("HikariCP's `maximumPoolSize = 5` (`application.conf:49`)") points to the **app pool**,
  but `DataTypeRowRepository.listRows` actually runs via `ctx.withSystemContext`, i.e. the **privileged
  pool** (`application.conf:80`). The numeric conclusion (peak concurrent ≈ `5 × 4.2MB ≈ 21MB`) is
  unaffected since both pools are independently capped at 5 — but the citation should point to line 80,
  not line 49, for accuracy. Worth a one-line fix in D1a, not blocking.
- D4, D5, D6, D7, D8, D9's reasoning independently re-verified against current code/spec and remain sound:
  `asNumeric`'s exclusion-not-null-not-zero handling, the `Option` wire convention for `min`/`max`/`mean`
  matching the established `sourceId`/`tag` pattern, the `findByIdOwned` RLS choke point, and the
  sensitive-data trade-off statement are all consistent with what I read directly.
- CR1 does not reopen round-1's cost-bound finding in the same severity class (the overflow entries carry
  no row *data*, just empty per-column accumulators), but it is a genuine wire-shape/spec violation that
  the design's own planned test would catch as a failure, not silently pass.

---

## Orchestrator disposition (post-round-3, human-reviewed)

The human coordinator reviewed this report directly (including independently re-verifying `maximumPoolSize
= 5` and `Page.Default.limit = 200` against the code) and made the call: **fold CR1 and CR2 into
design.md/tasks.md without spawning a 4th cold-skeptic round.** Rationale: both remaining findings are
mechanical (a `.take(SampleColumnLimit)` omission; a shared-function-location choice), not architectural —
the evaluator and the final cold skeptic still gate the actual implementation, and CR1's omission is
exactly what `spec.md`'s already-planned "Wide DataType caps columnStats columns" test would catch.

Three binding conditions attached to that decision (see `design.md` D2/D1a and `tasks.md` 3.1/4.2/2.1/2.2
for where each landed):
1. This report committed to disk before the executor was spawned (this file).
2. CR2 resolved as: shared utility (`DataTypeService.overflowStructuredFieldNames`, companion-object
   method), not per-call-site duplication — both call sites are Scala, so the Scala/TS duplication
   precedent doesn't apply.
3. `design.md` D1a gained an explicit, binding memory-retention requirement: the connection-pool argument
   bounds *in-flight query* memory, not *retained result* memory — `toDataTypeEntry` must consume each
   DataType's raw fetched rows into `sampleRows`/`columnStats` and let them go out of scope before the
   `Future.traverse` fan-out completes, never retaining the full `StatsRowLimit`-wide row set anywhere
   else. Stated as a requirement the executor must satisfy, not an assumption.
