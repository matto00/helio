## MODIFIED Requirements

### Requirement: CSV schema inference
The `SchemaInferenceEngine.fromCsv` function SHALL accept a raw CSV string (first row = headers), sample up to 100 data rows, and return an `InferredSchema`. Type detection SHALL use widening order: `IntegerType` → `FloatType` → `BooleanType` → `TimestampType` → `StringType`. Empty cells SHALL mark the field as nullable. Parsing SHALL comply with RFC 4180: fields MAY be enclosed in double-quotes; a double-quote inside a quoted field is escaped as two consecutive double-quotes (`""`); both CRLF and LF line endings SHALL be accepted.

#### Scenario: Header row becomes field names
- **WHEN** `fromCsv` is called with a CSV whose first row is `id,name,score`
- **THEN** the result contains fields named `id`, `name`, and `score`

#### Scenario: Integer column detected
- **WHEN** all non-empty values in a column parse as whole numbers
- **THEN** the field is inferred as `IntegerType`

#### Scenario: Float widens from integer
- **WHEN** a column contains both `1` and `1.5`
- **THEN** the field is inferred as `FloatType`

#### Scenario: Boolean detection
- **WHEN** all non-empty values in a column are `true`/`false` (case-insensitive)
- **THEN** the field is inferred as `BooleanType`

#### Scenario: Timestamp detection in CSV
- **WHEN** all non-empty values in a column match a supported date/datetime pattern
- **THEN** the field is inferred as `TimestampType`

#### Scenario: String is the widest type
- **WHEN** a column contains mixed values that don't fit any narrower type
- **THEN** the field is inferred as `StringType`

#### Scenario: Empty cell marks field nullable
- **WHEN** any cell in a column is empty
- **THEN** that field is marked `nullable = true`

#### Scenario: Sampling is capped at 100 rows
- **WHEN** `fromCsv` is called with a CSV containing more than 100 data rows
- **THEN** only the first 100 rows are used for type inference

#### Scenario: Quoted field with embedded comma is parsed as one field
- **WHEN** a CSV row contains `"Smith, John",30`
- **THEN** the first field value is `Smith, John` and the second is `30`

#### Scenario: Escaped double-quote inside quoted field
- **WHEN** a CSV row contains `"say ""hello""",ok`
- **THEN** the first field value is `say "hello"` and the second is `ok`

#### Scenario: CRLF line endings are accepted
- **WHEN** the CSV uses CRLF (`\r\n`) line endings
- **THEN** `fromCsv` produces the same result as the equivalent LF-only CSV
