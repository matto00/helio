# Tasks: Audit Inferred-Type Schema for Dummy Data

## Investigation

- [x] Map CSV inference path: `DataSourceService.createCsv` → `SchemaInferenceEngine.fromCsv`
- [x] Map Static inference path: `DataSourceService.createStatic` → `req.columns`
- [x] Map SQL inference path: `SourceService.createSql` → `SqlConnector.inferSchema` → `SchemaInferenceEngine.fromJson`
- [x] Map REST inference path: `SourceService.createRest` → `SchemaInferenceEngine.fromJson`
- [x] Audit `DemoData` — confirm no `DataType` or `DataSource` rows seeded
- [x] Audit `DataType` rows path — confirm no synthetic rows inserted at type-creation time
- [x] Audit `TypeDetailPanel` — confirm honest empty state (no fabricated preview rows)

## Regression Tests

- [x] CSV: 3-row, 2-column fixture → `DataType` has exactly 2 fields named per header
- [x] Static: 2-column payload → `DataType` has exactly 2 fields named per column spec
- [x] SQL: `SqlConnector.inferSchema` from in-memory rows → field names match column map keys
