## 1. Backend: row source bounding at the SQL tier (design.md D1)

- [x] 1.1 `DataTypeRowRepository.listRows` gains `limit: Option[Int] = None` and `excludeKeys:
      Set[String] = Set.empty`; `Some(n)` adds `LIMIT n` (still `ORDER BY row_index ASC`); non-empty
      `excludeKeys` selects `(data - $k1 - $k2 - ...)::text` instead of `data::text`, each key a bound
      param (no string-built SQL); both empty/`None` preserve today's exact unbounded query
- [x] 1.2 `DataTypeService.listRows` gains the same two params, forwarded to the repo after the existing
      `findByIdOwned` ownership check (no new RLS surface — design.md D4)
- [x] 1.3 `GET /api/types/:id/rows` (`DataTypeRoutes.scala`) accepts optional `limit` (reject `<= 0` with
      `400`, mirroring the existing `offset < 0` check) and `excludeContentFields` (boolean) query params;
      when `excludeContentFields=true` the route computes `excludeKeys` from the DataType's own
      `findById` fields via `DataFieldType.category`, forwarded to the service

## 2. Backend: sanitizer + protocol + service wiring

- [x] 2.1 Add `WorkspaceContextService.sanitizeSampleRows(fields: Vector[DataField], rawRows:
      Vector[JsObject]): Vector[JsObject]` (`private[services]` for direct unit-test access): filter
      `fields` to `DataFieldType.category(fromString(f.dataType)) == Structured` (unparseable →
      excluded), take the first 40 of those in declared order, then for each row/column value whose
      `compactPrint.length > 200` replace it with `JsString(compactPrint.take(200) + "…[truncated]")`
      (design.md D3 — exact marker text, applies to any oversized JsValue regardless of original type)
- [x] 2.2 Swap `WorkspaceContextService`'s constructor dependency from `dataTypeRepo: DataTypeRepository`
      to `dataTypeService: DataTypeService` (design.md D7); update the `new WorkspaceContextService(...)`
      call site in `ApiRoutes.scala:212` and the test fixture in `WorkspaceContextServiceSpec`
- [x] 2.3 In `assemble`, for each `dt` with `dt.sourceId.isEmpty` (pipeline-output), fetch
      `dataTypeService.listRows(dt.id, user, limit = Some(5), excludeKeys = dt.fields.filter(f =>
      DataFieldType.category(...) == Content).map(_.name).toSet)` and run it through
      `sanitizeSampleRows`; for `dt.sourceId.isDefined` (source-companion), set `sampleRows =
      Vector.empty` without a query (design.md D2)
- [x] 2.4 Add `sampleRows: Vector[JsObject]` to `WorkspaceContextDataType`; update its `jsonFormat8` →
      `jsonFormat9` (`WorkspaceContextProtocol.scala`) — field is always present (never `Option`), so no
      spray-json omission handling needed
- [x] 2.5 Add `sampleRows` (array, `maxItems: 5`, required, permissive item shape) to `DataTypeEntry` in
      `schemas/workspace-context.schema.json`, documenting the Structured-only/40-column/200-char/
      `"…[truncated]"` rules in the description

## 3. MCP: parity implementation (design.md D6)

- [x] 3.1 `helioApi.getDataTypeRows(dataTypeId: string, limit?: number, excludeContentFields?: boolean)`:
      append `?limit=`/`?excludeContentFields=` when given
- [x] 3.2 Add a `sanitizeSampleRows`-equivalent to `helio-mcp/src/context.ts` applying the identical
      Structured-only/40-column/200-char/`"…[truncated]"` rules from design.md D3, matching
      `WorkspaceContext['dataTypes'][number]['sampleRows']`'s new field in `types.ts`
- [x] 3.3 `buildWorkspaceContext`: for each pipeline-output DataType, call `api.getDataTypeRows(id, 5,
      true)` and sanitize; source-companion DataTypes get `sampleRows: []` without a call

## 4. Tests

- [x] 4.1 Before adding new cases, extract `WorkspaceContextServiceSpec`'s JSON-Schema-validation harness
      (`workspaceContextSchemaFile`, `schemaValidationErrors`) into
      `backend/src/test/scala/com/helio/testsupport/JsonSchemaValidation.scala` (design.md risk —
      pre-approved by the ticket brief)
- [x] 4.2 Unit tests for `sanitizeSampleRows`: row cap (>5 rows → 5), column cap (>40 Structured fields →
      first 40, by field order), Content-category field excluded from projection, oversized string cell
      truncated with the exact marker, oversized non-string cell also truncated to a `JsString` with the
      same marker, empty snapshot → `[]`
- [x] 4.3 `WorkspaceContextServiceSpec`: pipeline-output DataType with a run snapshot reports up to 5
      `sampleRows`; a DataType with no run reports `[]`; a source-companion DataType reports `[]`; a
      DataType with a `string-body` content field never includes that field's value in `sampleRows`
- [x] 4.4 `WorkspaceContextServiceSpec`: owner-scoping — user B's `sampleRows` never contain user A's row
      data (extends the existing 4.2 owner-scoping case)
- [x] 4.5 `WorkspaceContextServiceSpec` route-level (4.6 extension): schema validation passes with
      `sampleRows` present-and-nonempty on at least one entry
- [x] 4.6 `DataTypeRoutesSpec` (or extend existing): `GET /api/types/:id/rows?limit=2` returns at most 2
      rows; `?excludeContentFields=true` strips content field keys from the response; omitting both is
      unchanged (full snapshot); `limit=0` is `400`
- [x] 4.7 MCP unit test (`context.test.ts` or equivalent): `sampleRows` populated for a pipeline-output
      DataType and truncated per the same row/column/cell caps, including an oversized-non-string-cell
      case; `[]` for a source-companion DataType
- [x] 4.8 Run `sbt test` and the MCP test suite; confirm both green
