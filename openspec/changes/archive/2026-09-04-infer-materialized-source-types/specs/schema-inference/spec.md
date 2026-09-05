## MODIFIED Requirements

### Requirement: CSV schema inference
The `SchemaInferenceEngine.fromCsv` function SHALL accept a raw CSV string (first row = headers), sample up to 100 data rows, and return an `InferredSchema`. Every field SHALL be inferred as `StringType`, because the CSV row loader materializes every cell as a `String` and never casts it; a declared column type MUST match the runtime type of that column's materialized values. A caller that needs numeric or temporal values from a CSV column SHALL obtain them with an explicit `cast` step, which converts the values themselves. Empty cells SHALL mark the field as nullable. A data row with fewer cells than there are headers SHALL be treated as supplying an empty cell for each missing trailing column, so a column absent from a ragged row is marked nullable — the CSV path therefore already honours absence as evidence of nullability, consistent with the JSON path's composed rule. The CSV path SHALL continue to conflate "present but empty" with "absent": both mark the column nullable. This is a deliberate, retained divergence from the JSON path, where an empty string is a present, non-null `StringType` value; CSV has no on-the-wire encoding that distinguishes the two. Parsing SHALL comply with RFC 4180: fields MAY be enclosed in double-quotes; a double-quote inside a quoted field is escaped as two consecutive double-quotes (`""`); both CRLF and LF line endings SHALL be accepted.

#### Scenario: Header row becomes field names
- **WHEN** `fromCsv` is called with a CSV whose first row is `id,name,score`
- **THEN** the result contains fields named `id`, `name`, and `score`

#### Scenario: Integer column detected
- **WHEN** every non-empty value in a column parses as a whole number
- **THEN** the field is inferred as `StringType`, matching the `String` the row loader materializes

#### Scenario: Float widens from integer
- **WHEN** a column contains both `1` and `1.5`
- **THEN** the field is inferred as `StringType`

#### Scenario: Boolean detection
- **WHEN** every non-empty value in a column is `true`/`false` (case-insensitive)
- **THEN** the field is inferred as `StringType`

#### Scenario: Timestamp detection in CSV
- **WHEN** every non-empty value in a column matches a supported date/datetime pattern
- **THEN** the field is inferred as `StringType`

#### Scenario: String is the widest type
- **WHEN** a column contains mixed values that don't fit any narrower type
- **THEN** the field is inferred as `StringType`, as every CSV column now is

#### Scenario: Declared type matches the materialized runtime type
- **WHEN** a CSV source's inferred schema is compared against the runtime values the pipeline engine loads from the same CSV
- **THEN** every column declared `string` holds values whose runtime type is `String`

#### Scenario: Empty cell marks field nullable
- **WHEN** any cell in a column is empty
- **THEN** that field is marked `nullable = true`

#### Scenario: Ragged short row marks its missing trailing columns nullable
- **WHEN** a CSV has three headers and one data row supplies only two cells
- **THEN** the third column is marked `nullable = true`, on the same absence-as-evidence basis the JSON path uses

#### Scenario: Sampling is capped at 100 rows
- **WHEN** `fromCsv` is called with a CSV containing more than 100 data rows
- **THEN** only the first 100 rows are used for nullability inference

#### Scenario: Quoted field with embedded comma is parsed as one field
- **WHEN** a CSV row contains `"Smith, John",30`
- **THEN** the first field value is `Smith, John` and the second is `30`

#### Scenario: Escaped double-quote inside quoted field
- **WHEN** a CSV row contains `"say ""hello""",ok`
- **THEN** the first field value is `say "hello"` and the second is `ok`

#### Scenario: CRLF line endings are accepted
- **WHEN** the CSV uses CRLF (`\r\n`) line endings
- **THEN** `fromCsv` produces the same result as the equivalent LF-only CSV

## ADDED Requirements

### Requirement: Static source schema reflects materialized values
For static data sources, the system SHALL derive each field's type from the value that source actually materializes for that column, not from the user-declared `columns[].type`. A static source's rows are materialized by converting each stored JSON cell through the same conversion the pipeline engine uses, so a JSON number SHALL be reported as `float` (it materializes as a `Double`, including for whole numbers), a JSON string as `string`, and a JSON boolean as `boolean`. The user-declared `name` SHALL still be used for the field name. This SHALL apply identically on the create and refresh paths. Where a column's stored cells carry differing JSON kinds, the reported type SHALL be `string`. A column with no stored cells SHALL fall back to the declared type, canonicalized, with an unrecognised type string defaulting to `string`.

#### Scenario: Declared integer with numeric cells reports float
- **WHEN** a static source is created with a column declared `{ "name": "count", "type": "integer" }` and stored cells that are JSON numbers
- **THEN** the registered schema reports `count` as `float`, matching the `Double` it materializes

#### Scenario: Declared integer with string cells reports string
- **WHEN** a static source column is declared `integer` but its stored cells are JSON strings
- **THEN** the registered schema reports that column as `string`

#### Scenario: Boolean cells report boolean
- **WHEN** a static source column's stored cells are JSON booleans
- **THEN** the registered schema reports that column as `boolean`

#### Scenario: Mixed JSON kinds report string
- **WHEN** a static source column's stored cells contain both a JSON number and a JSON string
- **THEN** the registered schema reports that column as `string`

#### Scenario: Refreshing a static source also reports the materialized type
- **WHEN** an existing static source whose column is declared `integer` is refreshed with numeric cells
- **THEN** the refreshed schema reports that column as `float`, on the same basis as creation — the correction applies to the refresh path, not only the create path

#### Scenario: Column with no rows falls back to the declared type
- **WHEN** a static source is created with declared columns and an empty `rows` array
- **THEN** the registered schema reports each column's canonicalized declared type, defaulting to `string` when unrecognised

### Requirement: CSV field-type overrides are constrained to the materialized type
The system SHALL reject a CSV field-type override whose value is anything other than `string`, with an error naming the `cast` step as the supported way to obtain numeric or temporal values. A field override MAY still supply a `displayName`. This closes the only remaining path by which a CSV source's declared type could disagree with its materialized runtime type.

#### Scenario: Non-string CSV type override is rejected
- **WHEN** a CSV source is created with a field override declaring `dataType` of `integer`
- **THEN** the request is rejected with an error naming the `cast` step, and no source is created

#### Scenario: String CSV type override is accepted
- **WHEN** a CSV source is created with a field override declaring `dataType` of `string`
- **THEN** the source is created and the field is registered as `string`

#### Scenario: Display-name-only override is accepted
- **WHEN** a CSV field override supplies a `displayName` and a `dataType` of `string`
- **THEN** the override is applied

### Requirement: Declared-vs-runtime type divergence on the JSON, REST and SQL paths
The system SHALL document, and SHALL NOT silently alter, the known divergence between declared and materialized types on the JSON, REST and SQL source paths: a column inferred `integer` materializes as a `Double`, and a column inferred `timestamp` materializes as a `String`. This divergence is retained rather than aligned because closing it would move existing runtime row values and therefore change existing pipeline results. Aligning it is out of scope for this capability and requires its own change.

#### Scenario: Divergence is documented rather than aligned
- **WHEN** a REST or SQL source infers a column as `integer`
- **THEN** that column's rows materialize as `Double`, and this difference is stated in the capability specification rather than silently corrected

#### Scenario: CSV and JSON paths are not force-aligned
- **WHEN** the CSV and JSON inference paths are compared
- **THEN** their differing treatment of numeric-looking values is a stated, reasoned difference, not an inconsistency to be removed

## REMOVED Requirements

### Requirement: Static connector uses declared column types without inference
**Reason**: The declared `columns[].type` was never consulted when materializing a static source's rows — `parseStaticRows` converts each stored JSON cell directly — so the declared type was an unverified user assertion that could disagree with every value in the column. That is the same declared-vs-runtime defect this change removes for CSV.
**Migration**: Replaced by "Static source schema reflects materialized values". The declared `name` is still used; the declared `type` is now used only as a fallback for a column with no stored rows. A static source whose declared type disagreed with its cells will report the materialized type after its next create or refresh; a whole-number JSON cell reports `float` rather than `integer`, which remains eligible for every numeric panel slot.
