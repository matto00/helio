## ADDED Requirements

### Requirement: DataFieldType includes content field types
The `DataFieldType` sealed trait SHALL include two content variants in addition to the existing
5 structured variants: `StringBodyType` and `BinaryRefType`. `DataFieldType.asString` SHALL map
`StringBodyType` to `"string-body"` and `BinaryRefType` to `"binary-ref"`.

#### Scenario: New variants serialize to canonical wire strings
- **WHEN** `DataFieldType.asString(StringBodyType)` and `DataFieldType.asString(BinaryRefType)`
  are called
- **THEN** they return `"string-body"` and `"binary-ref"` respectively

### Requirement: DataFieldType supports reverse parsing
`DataFieldType.fromString(s: String): Option[DataFieldType]` SHALL return the matching variant
for each of the 7 canonical wire strings (`string`, `integer`, `float`, `boolean`, `timestamp`,
`string-body`, `binary-ref`) and `None` for any other input.

#### Scenario: Round-trip through asString and fromString
- **WHEN** `fromString(asString(t))` is called for any `DataFieldType` variant `t`
- **THEN** the result is `Some(t)`

#### Scenario: Unknown string returns None
- **WHEN** `fromString("unknown-type")` is called
- **THEN** the result is `None`

### Requirement: DataFieldType values classify into a FieldTypeCategory
`DataFieldType.category(t: DataFieldType): FieldTypeCategory` SHALL return `Structured` for
`StringType`/`IntegerType`/`FloatType`/`BooleanType`/`TimestampType` and `Content` for
`StringBodyType`/`BinaryRefType`.

#### Scenario: Structured type classifies as Structured
- **WHEN** `category(IntegerType)` is called
- **THEN** the result is `Structured`

#### Scenario: Content type classifies as Content
- **WHEN** `category(BinaryRefType)` is called
- **THEN** the result is `Content`

### Requirement: binary_refs table persists row-correlated binary reference metadata
A Flyway migration SHALL create a `binary_refs` table with columns: `id` (TEXT PK),
`data_type_id` (TEXT, indexed), `row_index` (INT), `field_name` (TEXT), `storage_key` (TEXT),
`mime_type` (TEXT), `filename` (TEXT), `size_bytes` (BIGINT), `created_at` (TIMESTAMPTZ), with a
unique index on `(data_type_id, row_index, field_name)`. `binary_refs` is a row-correlated
secondary index over the same metadata already present in the `binary-ref` field's inline JSONB
value in `data_type_rows.data` — it exists for lookups that don't require deserializing every
row (lifecycle management, future GC, asset browsing), never as an alternate read path for row
data. The inline JSONB value remains the sole source consumers read when processing a row.

#### Scenario: Migration creates the table
- **WHEN** the migration runs against the database
- **THEN** a `binary_refs` table exists with the specified columns, an index on `data_type_id`,
  and a unique index on `(data_type_id, row_index, field_name)`

### Requirement: BinaryRefRepository provides an overwrite-and-lookup contract
`BinaryRefRepository` SHALL expose `overwriteForDataType(dataTypeId: String, refs: Vector[BinaryRef]): Future[Unit]`
— a transactional delete-all-then-bulk-insert scoped to `dataTypeId`, mirroring
`DataTypeRowRepository.overwriteRows`'s semantics exactly — plus read-only
`findByDataTypeId(dataTypeId: String): Future[Vector[BinaryRef]]` and
`findByDataTypeIdAndRow(dataTypeId: String, rowIndex: Int): Future[Vector[BinaryRef]]`. There is
no singular `insert`/`delete(id)`: `overwriteForDataType` is the only writer, so a connector or
pipeline run that replaces a `DataType`'s row snapshot (via `overwriteRows`) SHALL call
`overwriteForDataType` for that run's binary refs in the same operation, keeping the index from
drifting or accumulating orphaned rows across re-runs.

#### Scenario: Overwrite replaces the prior snapshot
- **WHEN** `overwriteForDataType(dataTypeId, refs)` is called for a `dataTypeId` that already has
  `binary_refs` rows from a prior run
- **THEN** the prior rows for that `dataTypeId` are deleted and only `refs` remain

#### Scenario: Binary refs are listed by data type
- **WHEN** multiple `BinaryRef` records share the same `dataTypeId`
- **THEN** `findByDataTypeId` returns all of them

#### Scenario: Binary refs are looked up by data type and row
- **WHEN** `findByDataTypeIdAndRow(dataTypeId, rowIndex)` is called
- **THEN** it returns only the `BinaryRef` records matching both `dataTypeId` and `rowIndex`

### Requirement: Type Registry field editor offers content field types
The Type Registry field-type editor (`TypeDetailPanel`) SHALL include `string-body` and
`binary-ref` as selectable options alongside the existing 5 structured types.

#### Scenario: Content types appear as selectable options
- **WHEN** a user opens the data-type field editor for a field's data type
- **THEN** `string-body` and `binary-ref` appear in the options list alongside `string`,
  `integer`, `float`, `boolean`, `timestamp`
