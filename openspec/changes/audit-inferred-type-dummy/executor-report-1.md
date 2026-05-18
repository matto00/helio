# Executor Report — HEL-261 (Cycle 1)

## Audit Findings

### CSV inference path
**Entry**: `DataSourceService.createCsv` → `SchemaInferenceEngine.fromCsv(csvContent)`

`fromCsv` reads the first line as the header row and uses those strings verbatim
as field names. Type inference scans up to 100 data rows and widens the type
bottom-up (IntegerType → FloatType → StringType). No fallback constant table;
no fabricated fields.

**Verdict: CLEAN**

### Static inference path
**Entry**: `DataSourceService.createStatic` → `req.columns.map(col => DataField(col.name, col.name, col.type, ...))`

Field names and types come directly from the caller-supplied `StaticColumnPayload`
vector. No inference engine involved; no defaults injected.

**Verdict: CLEAN**

### REST API inference path
**Entry**: `SourceService.createRest` → `SchemaInferenceEngine.fromJson(json)` where `json` is the
response body from `RestApiConnector.fetch`.

`fromJson` flattens the JSON object graph using dot-notation keys. All field
names are derived from the actual JSON keys. No fallback names.

**Verdict: CLEAN**

### SQL inference path
**Entry**: `SourceService.createSql` → `SqlConnector.execute` → `SqlConnector.inferSchema(rows)` →
`SchemaInferenceEngine.fromJson(jsArray)`

`execute` reads JDBC column labels from `ResultSetMetaData.getColumnLabel(i)` and
uses them as map keys. `inferSchema` wraps the rows in a `JsArray` and runs
`fromJson` — so field names come from the JDBC result set, not from any constant.

**Verdict: CLEAN**

### DemoData startup seeding
`DemoData.seedIfEmpty` inserts **Dashboards and Panels only**. It does not
touch `data_sources` or `data_types`. The seeded panels use
`DataTypeId("")` (empty string) as a placeholder, which simply means "no type
bound yet" — this is in the panel's config blob, not a real DataType row.

**Verdict: No DataType seeding whatsoever. CLEAN**

### DataType rows at creation time
No code path inserts rows into `data_type_rows` at source-creation time.
Rows are populated exclusively by pipeline runs (`InProcessPipelineEngine`,
`SparkJobSubmitter`). An empty `DataType` is the correct initial state.

**Verdict: CLEAN**

### TypeRegistryBrowser / TypeDetailPanel (frontend)
`TypeDetailPanel` fetches rows via `fetchDataTypeRows` in a `useEffect` and
renders them via `PreviewTable`. When rows is an empty array, `PreviewTable`
shows the honest empty-state text:

> "No rows have been written to this type yet. Run a pipeline that writes to
> this type to populate it."

No "Sample" data, no placeholder rows, no fabricated preview.

**Verdict: CLEAN**

## What shipped

Audit found no dummy data injection anywhere. Three regression tests added to
make future drift detectable:

1. **`SchemaInferenceRegressionSpec`** (new file, `services/` package):
   - CSV 3-row 2-column fixture → exactly 2 fields named per header
   - CSV type derivation → integer / string from actual values
   - Static 2-column payload → exactly 2 fields named per column spec
   - Static explicit types pass through unchanged

2. **`SqlConnectorSpec`** (extended):
   - `SqlConnector.inferSchema` derives field names from row map keys only
   - Exactly as many fields as distinct columns — no extras
   - Empty row set → empty schema

## Intentional dummy data (acceptable)

One place where "placeholder" data is acceptable and expected:

- `DemoData` seeds panels with `DataTypeId("")` (empty string) in their
  config. This is not a fabricated DataType — it simply means the panel
  has no type binding yet. It is the correct initial state for a demo
  environment where no pipelines have run.

## Files modified

- `backend/src/test/scala/com/helio/services/SchemaInferenceRegressionSpec.scala` — new regression test (CSV + Static)
- `backend/src/test/scala/com/helio/domain/SqlConnectorSpec.scala` — added SQL inference regression section
- `openspec/changes/audit-inferred-type-dummy/` — proposal, tasks, workflow-state, this report
