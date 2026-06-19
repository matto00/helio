## ADDED Requirements

### Requirement: Typed MappedColumnType for JSONB-backed domain fields
The Slick repository layer SHALL define a `MappedColumnType` for each JSONB column that
maps to a stable Scala domain type, so that row case classes carry the parsed domain type
directly and repository methods contain no manual `.parseJson` / `.toJson.compactPrint`
calls for those columns.

The affected columns and their Scala target types are:
- `dashboards.appearance` → `DashboardAppearance`
- `dashboards.layout` → `DashboardLayout`
- `panels.appearance` → `PanelAppearance`
- `data_types.fields` → `Vector[DataField]`
- `data_types.computed_fields` → `Vector[ComputedField]`

The `panels.field_mapping` column (JSONB, `Option[String]` in the row) and
`data_sources.config` (polymorphic blob) are explicitly excluded from typed mapping.

#### Scenario: DashboardRow carries DashboardAppearance directly
- **WHEN** a dashboard row is loaded from the database
- **THEN** `DashboardRow.appearance` is a `DashboardAppearance` value, not a raw JSON string

#### Scenario: DashboardRow carries DashboardLayout directly
- **WHEN** a dashboard row is loaded from the database
- **THEN** `DashboardRow.layout` is a `DashboardLayout` value, not a raw JSON string

#### Scenario: PanelRow carries PanelAppearance directly
- **WHEN** a panel row is loaded from the database
- **THEN** `PanelRow.appearance` is a `PanelAppearance` value, not a raw JSON string

#### Scenario: DataTypeRow carries typed field vectors
- **WHEN** a data type row is loaded from the database
- **THEN** `DataTypeRow.fields` is a `Vector[DataField]` and `DataTypeRow.computedFields`
  is a `Vector[ComputedField]`, not raw JSON strings

### Requirement: fieldMapping column definition is consistent
The `panels.field_mapping` Slick column definition SHALL use the `jsonbStringType`
implicit `BaseColumnType[String]` (same as other JSONB string columns) rather than the
`O.SqlType("jsonb")` SQL-type hint, to be consistent with the rest of the table definition.

#### Scenario: fieldMapping column declared consistently
- **WHEN** the `PanelTable` column definition for `field_mapping` is inspected
- **THEN** it uses the `jsonbStringType` implicit rather than `O.SqlType("jsonb")`
