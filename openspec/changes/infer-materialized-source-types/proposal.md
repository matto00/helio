## Why

A DataSource's declared column type is a promise the data does not honour. `SchemaInferenceEngine.fromCsv`
declares `integer`/`float`/`boolean`/`timestamp`, but `InProcessPipelineEngine.loadCsvRowsFromBytes`
materializes every cell as a `String`, unconditionally. `static` sources are worse: `columns[].type` is
user-asserted and `PipelineRowJson.parseStaticRows` never consults it. Two sources that look identical in
the UI carry different runtime types, and the consumers that read the declared type — panel slot
eligibility and the assistant's column semantics — are misled with no way to detect it.

See `ticket.md` for the production evidence and the approved decision.

## What Changes

- CSV schema inference reports `string` for every column, because that is what the CSV loader actually
  materializes. Nullability inference is unchanged.
- Static source schemas are derived from the values the source actually materializes rather than from the
  user's declared `columns[].type`. **BREAKING** for a static source whose declared type disagreed with its
  stored cells; a whole-number JSON cell now reports `float`, since it materializes as a `Double`.
- **BREAKING**: a CSV field-type override may only be `string`. The API rejects any other value with a
  message naming the `cast` step; the upload UI disables the per-field data-type editor for CSV and says
  why. Without this, one click in the existing UI re-creates the exact defect this change removes.
- The JSON/REST/SQL divergence (`integer` materializes as `Double`, `timestamp` as `String`) is documented
  as a named, retained difference with its reason — not silently aligned.
- No runtime row value changes anywhere, so no existing pipeline result can change.

## Capabilities

### Modified Capabilities

- `schema-inference`: CSV inference reports the materialized type (`string`), not a parsed type; static
  sources infer from materialized values instead of declared types; CSV type overrides are constrained to
  `string`; the JSON/REST/SQL declared-vs-runtime divergence is stated as a retained difference.

## Impact

- Backend: `SchemaInferenceEngine.fromCsv`, `SchemaInferenceFacade.toSchemaFields`, `DataSourceService`
  (CSV create/refresh/infer and static create), `PipelineRowJson.parseStaticRows` (read-only reference).
- Frontend: `AddSourceModal` / `InferredFieldsTable` — data-type editing disabled for CSV.
- No Flyway migration. Persisted `data_sources.inferred_schema` rows are corrected on next refresh.
- Not touched: `RestApiConnectorDriver` and URL-backed fetching / `LocalFileSystem` (parallel-run boundaries).
