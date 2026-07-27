## 1. Backend: wire types and schema

- [x] 1.1 Add `WorkspaceContextColumnStats` case class (`nullRate: Double`, `distinctCount: Int`,
      `distinctCountCapped: Boolean`, `exampleValues: Vector[JsValue]`, `min: Option[Double]`, `max:
      Option[Double]`, `mean: Option[Double]`) to `WorkspaceContextProtocol.scala`; add `columnStats:
      Map[String, WorkspaceContextColumnStats]` to `WorkspaceContextDataType`.
- [x] 1.2 Add spray-json formats: `jsonFormat` for `WorkspaceContextColumnStats` (mind field count/order),
      a `Map[String, WorkspaceContextColumnStats]` format (spray-json's built-in `mapFormat`), and update
      `WorkspaceContextDataType`'s format arity.
- [x] 1.3 Update `schemas/workspace-context.schema.json`: add `ColumnStats` to `$defs` (`nullRate`,
      `distinctCount`, `distinctCountCapped`, `exampleValues` required; `min`/`max`/`mean` in `properties`
      typed `["number","null"]`, NOT in `required` — spray-json omission lesson); add `columnStats`
      (`type: object`, `additionalProperties: {"$ref": "#/$defs/ColumnStats"}`) to `DataTypeEntry`,
      required.

## 2. Backend: shared helper + SQL-tier column-count bound + route param

- [x] 2.1 Add `DataTypeService.overflowStructuredFieldNames(fields: Vector[DataField], limit: Int):
      Set[String]` to `DataTypeService`'s existing (currently empty) companion object
      (`DataTypeService.scala:174-178`) — Structured-category field names in `fields` beyond the first
      `limit`, in declared order; a field whose `dataType` doesn't parse is conservatively excluded from
      the Structured set entirely (design.md D1 round-3 fix — ONE shared implementation, reachable from
      both `WorkspaceContextService` and `DataTypeRoutes` without a new import, since both already depend
      on `DataTypeService`).
- [x] 2.2 In `WorkspaceContextService.scala`, add `StatsRowLimit = 500` (design.md D1). Change the
      `dataTypeService.listRows(...)` call in `toDataTypeEntry` to fetch `limit = Some(StatsRowLimit)` and
      `excludeKeys = contentFieldNames(dt.fields) ++ DataTypeService.overflowStructuredFieldNames(dt.fields,
      SampleColumnLimit)` — the query itself now returns at most 40 Structured columns per row (design.md
      D1, round-1 skeptic finding).
- [x] 2.3 In `DataTypeRoutes.scala`'s `/rows` route, add an optional `maxStructuredColumns`.as[Int] query
      param and change the route's branch condition from `if (!excludeContentFields)` to
      `if (!excludeContentFields && maxStructuredColumns.isEmpty)` (design.md D1 round-2 fix —
      `maxStructuredColumns` must take effect independently of `excludeContentFields`, not only when
      `excludeContentFields=true`). Inside the owner-scoped-lookup branch, build `excludeKeys` as the union
      of `(if (excludeContentFields) contentFieldNames else Set.empty)` and
      `(maxStructuredColumns.map(n => DataTypeService.overflowStructuredFieldNames(dt.fields, n)).getOrElse(Set.empty))`
      — each part independently optional, using 2.1's shared helper. Omitting both params preserves today's
      exact behavior — additive, backward-compatible (design.md D1/Migration Plan).
- [x] 2.4 In `helio-mcp/src/helioApi.ts`, add a 4th optional `maxStructuredColumns?: number` param to
      `getDataTypeRows`, forwarded as `?maxStructuredColumns=`.

## 3. Backend: statistics computation

- [x] 3.1 Implement `computeColumnStats(fields: Vector[DataField], rawRows: Vector[JsObject]): Map[String,
      WorkspaceContextColumnStats]` (`private[services]`, unit-testable). **First**: filter `fields` to
      Structured-category and `.take(SampleColumnLimit)` (40) in declared order — identical to
      `sanitizeSampleRows`'s own column projection (`WorkspaceContextService.scala:224`) — this is REQUIRED
      and independent of 2.2's SQL-tier `excludeKeys` bound (design.md D2 round-3 fix: the SQL-tier bound
      alone does not cap `computeColumnStats`'s own column *enumeration*, only what Postgres transfers).
      **Then**, for each of those (at most 40) columns, fold over `rawRows` computing `nullRate` (`0` when
      `rawRows.isEmpty`, not `NaN` — design.md D8), capped `distinctCount` + `distinctCountCapped`
      (design.md D4, 200-char truncation per design.md D3), first-5-distinct `exampleValues` in row order
      (design.md D6); for `integer`/`float`-declared columns additionally accumulate `min`/`max`/`mean` via
      `asNumeric` (design.md D5), rounding `mean` to 4 decimals. Must produce one entry per (capped)
      Structured-category column even when `rawRows` is empty (design.md D8's empty-snapshot branch) — but
      never more than 40 entries regardless.
- [x] 3.2 Implement `asNumeric(v: JsValue): Option[Double]` (design.md D5): `JsNumber` direct,
      `JsString(s)` via `s.trim.toDoubleOption`, everything else `None`.
- [x] 3.3 Wire `computeColumnStats(dt.fields, rawRows)` into `toDataTypeEntry`'s success branch — called for
      EVERY successful `Right(rawRows)` fetch, whether `rawRows` is empty or not (design.md D8). Only the
      `Left` (listRows failure) and source-companion (`dt.sourceId.isDefined`, no query made) branches
      degrade to `columnStats = Map.empty`, same as `sampleRows = Vector.empty` — do not lump the
      empty-snapshot case in with those two. **Memory-retention requirement (design.md D1a, binding):**
      derive `sampleRows` and `columnStats` from `rawRows` within the same `Future.map`/`for`-comprehension
      step that produces the finished `WorkspaceContextDataType`, and confirm (by reading the resulting
      code, not assuming it) that no accumulator or intermediate collection outside that step retains a
      reference to any DataType's raw ≤500-row fetch once its entry is built — only the bounded
      `sampleRows`/`columnStats` outputs may survive past that point.
- [x] 3.4 Add `WorkspaceContextColumnStats` case class (`nullRate: Double`, `distinctCount: Int`,
      `distinctCountCapped: Boolean`, `exampleValues: Vector[JsValue]`, `min: Option[Double]`, `max:
      Option[Double]`, `mean: Option[Double]`) to `WorkspaceContextProtocol.scala`; add `columnStats:
      Map[String, WorkspaceContextColumnStats]` to `WorkspaceContextDataType`.
- [x] 3.5 Add spray-json formats: `jsonFormat` for `WorkspaceContextColumnStats` (mind field count/order),
      a `Map[String, WorkspaceContextColumnStats]` format (spray-json's built-in `mapFormat`), and update
      `WorkspaceContextDataType`'s format arity.
- [x] 3.6 Update `schemas/workspace-context.schema.json`: add `ColumnStats` to `$defs` (`nullRate`,
      `distinctCount`, `distinctCountCapped`, `exampleValues` required; `min`/`max`/`mean` in `properties`
      typed `["number","null"]`, NOT in `required` — spray-json omission lesson); add `columnStats`
      (`type: object`, `additionalProperties: {"$ref": "#/$defs/ColumnStats"}`) to `DataTypeEntry`,
      required.

## 4. MCP: TS mirror

- [x] 4.1 In `helio-mcp/src/context.ts`, add `STATS_ROW_LIMIT = 500`; change the `getDataTypeRows(t.id,
      SAMPLE_ROW_LIMIT, true)` call in `buildWorkspaceContext` to `getDataTypeRows(t.id, STATS_ROW_LIMIT,
      true, SAMPLE_COLUMN_LIMIT)` (using 2.4's new 4th param), feeding the same fetched array into both
      `sanitizeSampleRows` (unchanged) and a new `computeColumnStats`.
- [x] 4.2 Implement `computeColumnStats` in TS mirroring 3.1/3.2/design.md D2/D5/D6/D10 exactly, INCLUDING
      3.1's `.take(SAMPLE_COLUMN_LIMIT)` column-enumeration cap (same constants: 200-char truncation,
      distinct cap 100, 5 example values, 4-decimal mean rounding); must produce one entry per (capped, at
      most 40) Structured-category column even when the fetched row array is empty.
- [x] 4.3 Add `columnStats` to the `WorkspaceContext` interface's `dataTypes[]` entry shape, matching the
      schema's `ColumnStats` def field-for-field.

## 5. Tests

- [x] 5.1 Backend `WorkspaceContextServiceSpec`: numeric column reports min/max/mean; non-numeric column
      omits them; numeric-declared column with unparseable strings reports no min/max/mean and `nullRate:
      0`; numeric-declared column with string-encoded numbers (CSV case) still computes correctly;
      all-null column reports `nullRate: 1`, no min/max; empty-snapshot DataType reports `columnStats`
      entries with `nullRate: 0`/`distinctCount: 0` per Structured column, not omitted (verifies 3.3's
      branch precision); wide DataType (>40 Structured columns) reports no `columnStats` entry for overflow
      columns, in BOTH the empty-snapshot and non-empty-snapshot cases (verifies 3.1's own
      `.take(SampleColumnLimit)` enumeration cap, not just 2.2's SQL-tier `excludeKeys` extension — the two
      are complementary, design.md D2 round-3); high-cardinality column reports `distinctCountCapped: true`;
      Content-category column has no `columnStats` entry;
      determinism (two calls over an unchanged snapshot produce identical `columnStats`); owner-scoping
      (user B never sees user A's `columnStats`, mirroring the existing `sampleRows` cross-user test).
- [x] 5.2 Backend: unit-test `computeColumnStats`/`asNumeric` directly (`private[services]`) for the cases
      above without a DB fixture per case, following `sanitizeSampleRows`'s existing pattern, including the
      empty-`rawRows` case producing non-empty per-column entries. Also unit-test
      `DataTypeService.overflowStructuredFieldNames` directly: fewer fields than the limit (empty result),
      exactly at the limit (empty result), beyond the limit (correct overflow names, in declared order),
      and an unparseable `dataType` string (excluded from both the counted-toward-limit set and the
      overflow set).
- [x] 5.3 Backend: route-level test for `/rows`'s new `maxStructuredColumns` param, asserting the exact
      behavior design.md D1 defines for each combination: (a) `maxStructuredColumns` alone (no
      `excludeContentFields`) excludes only the column-count overflow — Content-category field values ARE
      still present in the response; (b) `excludeContentFields=true` alone (today's existing behavior,
      unchanged) excludes only Content fields; (c) both together (the MCP's actual call shape) excludes
      both; (d) neither param preserves the plain unbounded-`listRows` response exactly as today.
- [x] 5.4 Backend: schema-validate a full `WorkspaceContextResponse` including `columnStats` against
      `schemas/workspace-context.schema.json` for both a numeric-column-present and a
      numeric-column-absent case (the field-present/field-absent branches, per design.md D7's explicit
      lesson).
- [x] 5.5 MCP `context.test.ts`: unit tests for `computeColumnStats` mirroring 5.1's cases (numeric vs.
      non-numeric, unparseable numeric strings, all-null, empty snapshot, capped distinct count, Content
      exclusion, determinism); assert `buildWorkspaceContext` calls `getDataTypeRows` with `STATS_ROW_LIMIT`
      (500) and `maxStructuredColumns` (40), not the old sample-only limit, exactly once per
      pipeline-output DataType.
- [x] 5.6 Run `sbt test` (backend) and the MCP test suite; run `openspec validate
      column-statistics-workspace-context --strict` and fix any errors.
