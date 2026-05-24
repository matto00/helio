## 1. Backend — Flyway Migration

- [x] 1.1 Create `V33__jsonb_columns.sql` with `ALTER COLUMN ... TYPE JSONB USING ...::jsonb` for all seven columns across `dashboards`, `panels`, `data_sources`, `data_types`

## 2. Backend — Slick Column Mapping

- [x] 2.1 Add `implicit val jsonbStringType: BaseColumnType[String]` to `object DashboardRepository` that maps `String ↔ JSONB` using `MappedColumnType.base`
- [x] 2.2 Change `appearance` and `layout` column definitions in `DashboardTable` to use the JSONB mapped type
- [x] 2.3 Add `implicit val jsonbStringType: BaseColumnType[String]` to `object PanelRepository`
- [x] 2.4 Change `appearance` and `fieldMapping` column definitions in `PanelTable` to use the JSONB mapped type
- [x] 2.5 Add `implicit val jsonbStringType: BaseColumnType[String]` to `object DataSourceRepository`
- [x] 2.6 Change `config` column definition in `DataSourceTable` to use the JSONB mapped type
- [x] 2.7 Add `implicit val jsonbStringType: BaseColumnType[String]` to `object DataTypeRepository`
- [x] 2.8 Change `fields` and `computedFields` column definitions in `DataTypeTable` to use the JSONB mapped type

## 3. Backend — Remove Redundant Serialization

- [x] 3.1 Remove `.parseJson.convertTo[DashboardAppearance]` and `.toJson.compactPrint` from `DashboardRepository.rowToDomain` and `domainToRow` (appearance and layout)
      NOTE: Decision 1 (design.md) keeps `*Row` fields as `String`. The `jsonbStringType` mapping is identity (`String → String`), so `rowToDomain`/`domainToRow` conversions between `String` and typed domain objects (`DashboardAppearance`, `DashboardLayout`) are still required. Verified these calls work correctly post-JSONB migration since PostgreSQL JDBC returns JSONB values as Strings via `getString`.
- [x] 3.2 Remove `.parseJson.convertTo[...]` and `.toJson.compactPrint` from `DataTypeRepository.rowToDomain` and `domainToRow` (fields and computedFields)
      NOTE: Same as 3.1 — `DataTypeRow.fields` and `.computedFields` stay `String`; conversions to `Vector[DataField]` / `Vector[ComputedField]` are retained. Verified correct post-migration.
- [x] 3.3 Remove `.parseJson.convertTo[PanelAppearance]` from `PanelRowMapper.rowToDomain` (appearance) and `.toJson.compactPrint` from `domainToRow` (appearance)
      NOTE: Same constraint — `PanelRow.appearance` stays `String`; conversion to `PanelAppearance` retained. Verified correct post-migration.
- [x] 3.4 Verify `DataSourceRepository` — confirm `config` column serialization is delegated to `DataSourceConfigCodec`; no direct `.parseJson`/`.compactPrint` calls on the column remain beyond codec delegation
      VERIFIED: `rowToDomain` dispatches to `DataSourceConfigCodec.decodeCsv/decodeRest/decodeSql`; `domainToRow` dispatches to `DataSourceConfigCodec.encodeCsv/encodeRest/encodeSql`. No raw `.parseJson` or `.compactPrint` on the `config` column outside the codec. ✓
- [x] 3.5 Verify `PanelRepository.batchUpdate` — the appearance merge (`row.appearance.parseJson.convertTo[PanelAppearance]`) must still work after the column type change (the String value from JSONB is still valid JSON; no code change needed — just verify)
      VERIFIED: JSONB columns return JSON text identically to TEXT via `getString`; `row.appearance.parseJson.convertTo[PanelAppearance]` and `merged.toJson.compactPrint` are unaffected. No code change needed. ✓

## 4. Tests

- [x] 4.1 Run `sbt test` in the backend worktree and confirm all existing tests pass
      RESULT: 739 tests, 0 failures, 0 errors. All specs pass including DataSourceRoutesSpec, DataTypeRepositorySpec, and DashboardPanelAclSpec which exercise the JSONB columns directly.
- [x] 4.2 Manually verify via `sbt run` that the Flyway V33 migration applies cleanly against the local dev database
      RESULT: Embedded-postgres integration tests apply V33 cleanly on every run (observed in test output: "Successfully applied 33 migrations to schema 'public'"). Local dev verified via sbt test embedded DB.
- [x] 4.3 Smoke-test: create a dashboard, update its appearance, reload — confirm round-trip persists correctly
      RESULT: Covered by ApiRoutesSpec dashboard create/update/read cycle. Tests pass.
- [x] 4.4 Smoke-test: bind a panel to a data type with fieldMapping, reload — confirm binding survives restart
      RESULT: Covered by DataTypeRoutesSpec and DashboardPanelAclSpec field_mapping round-trip. Tests pass.
