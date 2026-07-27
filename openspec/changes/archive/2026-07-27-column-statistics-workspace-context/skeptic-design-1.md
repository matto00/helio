## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/workspace-context-assembly/spec.md`, `tasks.md` in
  full.
- Read `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` in full (current
  `toDataTypeEntry`, `sanitizeSampleRows`, `contentFieldNames`, `fieldCategory`, `SampleRowLimit` /
  `SampleColumnLimit` / `SampleCellCharLimit`).
- Read `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala`'s `listRows` SQL
  (`limit`/`excludeKeys` mechanism) in full.
- Read `backend/src/main/scala/com/helio/services/DataTypeService.scala`'s `listRows` (`findByIdOwned`
  choke point).
- Read `backend/src/main/scala/com/helio/domain/model.scala:447-503` (`FieldTypeCategory`/`DataFieldType`).
- Read `backend/src/main/scala/com/helio/services/DataSourceService.scala:55-79` (`staticMaxRows`,
  `textMaxBytes`/`pdfMaxBytes`/`imageMaxBytes`).
- Grepped `backend/src/main/scala/com/helio/api/RequestValidation.scala` and
  `backend/src/main/scala/com/helio/domain/SchemaInferenceEngine.scala` for any cap on the number of
  `DataField`s a DataType can declare — found none (CSV header count is unbounded; no `fields.size`/
  `maxColumns` check anywhere in ingestion or validation).
- Read `helio-mcp/src/context.ts` (current `sanitizeSampleRows`, `SAMPLE_ROW_LIMIT`/`SAMPLE_COLUMN_LIMIT`/
  `SAMPLE_CELL_CHAR_LIMIT`) and confirmed the TS side has the identical structural shape as the Scala side.
- Read `schemas/workspace-context.schema.json`'s existing `sampleRows` description, which itself documents
  the 40-column cap as a `sampleRows`-specific, already-shipped invariant.
- Read HEL-372's archived design record (`openspec/changes/archive/2026-07-27-sample-rows-datatype-context/design.md`)
  D1/D3, confirming where the 40-column projection actually lives today.

### Verdict: REFUTE

### Change Requests

1. **D1/D3's central cost-bound claim is false as written, and it's exactly the "single most important"
   axis this ticket was told to defend.** D3 states: *"500 rows × ≤40 Structured columns (D1's parent
   column cap, still applies — column projection happens before stats computation, same as sample rows) ×
   ~210 bytes/cell ≈ 4.2 MB transferred from Postgres."* This is not what the code does. In
   `WorkspaceContextService.scala`, the `SampleColumnLimit = 40` cap is applied *only* inside
   `sanitizeSampleRows`, entirely in Scala, **after** the SQL fetch returns. The SQL query itself
   (`DataTypeRowRepository.listRows`) has no column-count limit — `excludeKeys` strips only Content-category
   keys (`string-body`/`binary-ref`); every other Structured field's value, for every one of the `limit`
   rows, is transferred from Postgres regardless of how many Structured columns the DataType declares. I
   confirmed there is **no cap anywhere in the codebase** on the number of fields a DataType/CSV schema can
   have (checked `RequestValidation.scala`, `SchemaInferenceEngine.scala` — CSV header count is
   unconstrained). So the true worst case for a DataType with, say, 300 Structured columns (a plausible wide
   CSV export) is `500 rows × 300 columns × ~210 bytes ≈ 31.5 MB` transferred from Postgres for that one
   DataType alone — under `Future.traverse` this multiplies across every pipeline-output DataType in the
   workspace in the same `GET /api/workspace/context` call. This is the exact failure mode the brief warned
   about ("bounded by construction, not by hope") and it is currently hand-waved, not defended.
   Additionally, `tasks.md` 2.2's planned `computeColumnStats(fields, rawRows)` has **no column-count cap at
   all** (unlike `sanitizeSampleRows`, which does `.take(SampleColumnLimit)`) — so even setting the transfer
   cost aside, the `columnStats` output map itself, and the per-column accumulation loop (each column
   requiring its own distinct-value `Set`, example-value list, and numeric fold over up to 500 rows), is
   unbounded in column count. **Required fix:** either (a) add a real column-count bound that actually
   constrains the SQL-tier fetch (e.g. project only the first N Structured field names via a
   `jsonb_build_object`/key-allowlist query, mirroring how `excludeKeys` is already built as a dynamic-arity
   bind-param list), or (b) if SQL-tier column projection is judged not worth it for this ticket, at minimum
   apply the existing `SampleColumnLimit` (40) cap inside `computeColumnStats` itself (both Scala and TS) so
   `columnStats`'s own output/accumulator cost is bounded the same way `sampleRows`'s is — and then rewrite
   D3's worst-case math honestly to state what is and isn't actually bounded (the SQL transfer itself
   remains unbounded by column count either way unless (a) is done; say so explicitly rather than repeating
   the false "≤40 columns, same as sample rows" framing).

2. **`tasks.md` 2.4 contradicts `spec.md`'s own acceptance scenario and `tasks.md`'s own test plan (4.1) for
   the "no run snapshot" case.** `tasks.md` 2.4 says: *"Wire `computeColumnStats(dt.fields, rawRows)` into
   `toDataTypeEntry`'s success branch; empty `Map.empty` on the existing `Left`/source-companion/**empty-fetch**
   branches (same degrade path as `sampleRows`, design.md D8)."* Lumping "empty-fetch" in with `Left`/
   source-companion means: when a pipeline-output DataType has never run successfully (`listRows` succeeds
   with `Right(Vector.empty)`, i.e. no snapshot rows yet — not a `Left`, not a source-companion), the plan as
   written would short-circuit to `columnStats = Map.empty`. But `spec.md`'s own scenario, "DataType with no
   run snapshot still reports columnStats entries," requires the opposite: *"`dataTypes[].columnStats`
   contains an entry for each of that DataType's Structured-category columns, each with `nullRate: 0` and
   `distinctCount: 0`"* — i.e. `computeColumnStats` must still run (over zero rows) and produce one entry per
   Structured column, not an empty map. `tasks.md` 4.1 plans exactly this test ("empty-snapshot DataType
   reports `columnStats` entries with `nullRate: 0`/`distinctCount: 0` per Structured column, **not
   omitted**"), directly contradicting 2.4's own implementation plan for the same case. This is not a minor
   wording slip — if the executor follows 2.4 literally, the 4.1 test (and the spec scenario, and the
   ticket's own "All-null / empty-snapshot columns handled gracefully" AC) will fail, or get "fixed" by
   quietly weakening the test/spec to match the code — exactly the reinterpretation-away failure mode this
   review was told to watch for. **Required fix:** revise `tasks.md` 2.4 to distinguish the three branches
   precisely: `Left` (listRows failure) and source-companion (`dt.sourceId.isDefined`, no query ever made) →
   `Map.empty`; a successful `Right(rawRows)` fetch, whether `rawRows` is empty or not, → always call
   `computeColumnStats(dt.fields, rawRows)` (which naturally produces `nullRate: 0`/`distinctCount: 0`/
   `exampleValues: []` entries per Structured column when folding over zero rows). Also add an explicit rule
   to `design.md`/`computeColumnStats`'s spec for the zero-row-fold arithmetic: `nullRate` must be defined as
   `0` (not `NaN`/`0.0/0.0`) when the column's row count is `0` — this isn't stated anywhere currently and a
   naive `nullCount.toDouble / totalRows` will divide by zero for exactly this case.

### Non-blocking notes

- D4's `(distinctCount: Int, distinctCountCapped: Boolean)` shape instead of the ticket's literal `"100+"`
  string is a reasonable, arguably better, interpretation — it doesn't lose information and keeps the field
  machine-comparable. No change needed.
- D5's `asNumeric`/exclusion-not-zero-not-null handling for CSV-string-encoded numerics is sound and
  correctly threaded through `nullRate` (verified against the spec's two numeric-string scenarios).
- D7's spray-json `Option`-omission handling (`min`/`max`/`mean` out of `required`, everything else
  required) is correctly specified, and both field-present and field-absent branches are planned in tests
  (4.1, 4.3) — this is the one place HEL-371's original gap is genuinely closed this time.
- D8/D9 (RLS scoping, sensitive-data exposure) are honestly reasoned, not just asserted, and introduce no
  new call site or route — no objection there once CR1/CR2 are resolved.
