## 1. Backend — DashboardRepository

- [x] 1.1 Add `dashboardAppearanceColumnType: BaseColumnType[DashboardAppearance]` to `DashboardRepository` companion object using `MappedColumnType.base`
- [x] 1.2 Add `dashboardLayoutColumnType: BaseColumnType[DashboardLayout]` to `DashboardRepository` companion object using `MappedColumnType.base`
- [x] 1.3 Change `DashboardRow.appearance` from `String` to `DashboardAppearance`
- [x] 1.4 Change `DashboardRow.layout` from `String` to `DashboardLayout`
- [x] 1.5 Update `DashboardTable` column defs: `appearance` uses `dashboardAppearanceColumnType`, `layout` uses `dashboardLayoutColumnType`
- [x] 1.6 Remove `jsonbStringType` from `DashboardRepository` companion (no longer needed)
- [x] 1.7 Remove `.parseJson.convertTo[…]` calls from `rowToDomain` (`appearance`, `layout`)
- [x] 1.8 Remove `.toJson.compactPrint` calls from `domainToRow` (`appearance`, `layout`)
- [x] 1.9 Remove `.toJson.compactPrint` calls from `update` method tuple (`appearance`, `layout`)

## 2. Backend — PanelRepository and PanelRowMapper

- [x] 2.1 Add `panelAppearanceColumnType: BaseColumnType[PanelAppearance]` to `PanelRepository` companion object
- [x] 2.2 Change `PanelRow.appearance` from `String` to `PanelAppearance`
- [x] 2.3 Update `PanelTable` column def: `appearance` uses `panelAppearanceColumnType`
- [x] 2.4 Fix `fieldMapping` column def: replace `O.SqlType("jsonb")` with `jsonbStringType` implicit (keep column type `Option[String]`)
- [x] 2.5 Remove `.parseJson.convertTo[PanelAppearance]` from `PanelRowMapper.rowToDomain`
- [x] 2.6 Remove `.toJson.compactPrint` from `PanelRowMapper.domainToRow` for `appearance`
- [x] 2.7 Remove `.parseJson.convertTo[PanelAppearance]` / `.toJson.compactPrint` from `PanelRepository.batchUpdate` (appearance merge)
- [x] 2.8 Remove `.toJson.compactPrint` from `PanelRepository.updateAppearance`

## 3. Backend — DataTypeRepository

- [x] 3.1 Add `dataFieldsColumnType: BaseColumnType[Vector[DataField]]` to `DataTypeRepository` companion object
- [x] 3.2 Add `computedFieldsColumnType: BaseColumnType[Vector[ComputedField]]` to `DataTypeRepository` companion object
- [x] 3.3 Change `DataTypeRow.fields` from `String` to `Vector[DataField]`
- [x] 3.4 Change `DataTypeRow.computedFields` from `String` to `Vector[ComputedField]`
- [x] 3.5 Update `DataTypeTable` column defs: `fields` uses `dataFieldsColumnType`, `computedFields` uses `computedFieldsColumnType`
- [x] 3.6 Remove `jsonbStringType` from `DataTypeRepository` companion (no longer needed)
- [x] 3.7 Remove `.parseJson.convertTo[…]` calls from `rowToDomain` (`fields`, `computedFields`)
- [x] 3.8 Remove `.toJson.compactPrint` calls from `domainToRow` (`fields`, `computedFields`)
- [x] 3.9 Remove `.toJson.compactPrint` calls from `update` and `updateInternal` tuple updates (`fields`, `computedFields`)

## 4. Tests

- [x] 4.1 Run `sbt test` in the worktree backend; confirm all tests pass
