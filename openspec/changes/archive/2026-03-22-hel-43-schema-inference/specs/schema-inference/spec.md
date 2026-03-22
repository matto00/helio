## ADDED Requirements

### Requirement: JSON schema inference
The `SchemaInferenceEngine.fromJson` function SHALL accept a `spray.json.JsValue` and return an `InferredSchema`. If the root value is a `JsArray` of objects, fields are inferred from the union of keys across all elements. If the root is a `JsObject`, fields are inferred directly from its keys. Nested `JsObject` values SHALL be flattened using dot notation. All other root shapes return an empty schema.

#### Scenario: Root object infers fields from keys
- **WHEN** `fromJson` is called with a `JsObject` containing keys `id` (number), `name` (string), `active` (boolean)
- **THEN** the result contains fields `id: IntegerType`, `name: StringType`, `active: BooleanType`, all non-nullable

#### Scenario: Root array infers union of keys
- **WHEN** `fromJson` is called with a `JsArray` of two objects where one has key `x` and another has keys `x` and `y`
- **THEN** the result contains both `x` and `y` fields

#### Scenario: Nested object is flattened with dot notation
- **WHEN** `fromJson` is called with `{ "address": { "city": "London" } }`
- **THEN** the result contains a field named `address.city` of type `StringType`

#### Scenario: Null value marks field as nullable
- **WHEN** a field is `JsNull` in any sampled object
- **THEN** that field is marked `nullable = true`

#### Scenario: Float vs integer distinction
- **WHEN** a numeric field value is `1` (no decimal)
- **THEN** it is inferred as `IntegerType`
- **WHEN** a numeric field value is `1.5` (with decimal)
- **THEN** it is inferred as `FloatType`

#### Scenario: String matching timestamp pattern infers TimestampType
- **WHEN** a string field value matches ISO-8601 date or datetime format (e.g. `"2024-01-15"`, `"2024-01-15T10:30:00Z"`)
- **THEN** the field is inferred as `TimestampType`

### Requirement: CSV schema inference
The `SchemaInferenceEngine.fromCsv` function SHALL accept a raw CSV string (first row = headers), sample up to 100 data rows, and return an `InferredSchema`. Type detection SHALL use widening order: `IntegerType` → `FloatType` → `BooleanType` → `TimestampType` → `StringType`. Empty cells SHALL mark the field as nullable.

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

### Requirement: DataFieldType sealed type
The `DataFieldType` sealed trait SHALL define exactly five variants: `StringType`, `IntegerType`, `FloatType`, `BooleanType`, `TimestampType`. An `asString` method SHALL return the canonical lowercase string representation used for storage in `DataField.dataType`.

#### Scenario: asString produces canonical names
- **WHEN** `DataFieldType.asString` is called on each variant
- **THEN** it returns `"string"`, `"integer"`, `"float"`, `"boolean"`, `"timestamp"` respectively

### Requirement: displayName auto-generation
`SchemaInferenceEngine` SHALL generate a human-readable `displayName` from a raw field name by converting `snake_case`, `camelCase`, and dot-separated paths to title-case words.

#### Scenario: snake_case to title case
- **WHEN** the field name is `created_at`
- **THEN** `displayName` is `"Created At"`

#### Scenario: camelCase to title case
- **WHEN** the field name is `firstName`
- **THEN** `displayName` is `"First Name"`

#### Scenario: dot-separated path to title case
- **WHEN** the field name is `address.city`
- **THEN** `displayName` is `"Address City"`
