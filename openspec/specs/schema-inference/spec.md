## Purpose
Defines how `SchemaInferenceEngine` infers a `DataType`'s field schema (names, `DataFieldType`,
nullability, display names) from JSON, CSV, and static-connector sources, and the REST endpoints
that preview an inferred schema without persisting it.

## Requirements

### Requirement: JSON schema inference
The `SchemaInferenceEngine.fromJson` function SHALL accept a `spray.json.JsValue` and return an `InferredSchema`. If the root value is a `JsArray` of objects, fields are inferred from the union of the dotted leaf paths of ALL elements — at every nesting level, not only the top level — so a path present in any sampled object appears in the schema regardless of that object's position in the array. If the root is a `JsObject`, fields are inferred directly from its leaf paths. Nested `JsObject` values SHALL be flattened using dot notation, via the shared bounded traversal defined by the `nested-json-flattening` capability — the same traversal from which rows are materialised, so an inferred dotted field is always a field the rows actually carry. Array values SHALL be leaves, inferred as `StringType`, and SHALL NOT be expanded into index-bearing field names. An object at the traversal's depth bound SHALL be inferred as a single `StringType` field at its dotted path. The type of each field SHALL be the widened type of that path's values across all sampled objects (see the JSON type widening requirement), not the type of the first value encountered. All other root shapes return an empty schema.

#### Scenario: Root object infers fields from keys
- **WHEN** `fromJson` is called with a `JsObject` containing keys `id` (number), `name` (string), `active` (boolean)
- **THEN** the result contains fields `id: IntegerType`, `name: StringType`, `active: BooleanType`, all non-nullable

#### Scenario: Root array infers union of keys
- **WHEN** `fromJson` is called with a `JsArray` of two objects where one has key `x` and another has keys `x` and `y`
- **THEN** the result contains both `x` and `y` fields

#### Scenario: Nested sub-keys are unioned across elements
- **WHEN** `fromJson` is called with a `JsArray` whose first element is `{ "stats": { "a": 1 } }` and whose second element is `{ "stats": { "b": 2 } }`
- **THEN** the result contains BOTH `stats.a` and `stats.b`

#### Scenario: A field absent from the first element still appears
- **WHEN** `fromJson` is called with a `JsArray` deliberately ordered so that its first element lacks a nested path that a later element carries
- **THEN** that path appears in the inferred schema

#### Scenario: Nested object is flattened with dot notation
- **WHEN** `fromJson` is called with `{ "address": { "city": "London" } }`
- **THEN** the result contains a field named `address.city` of type `StringType`

#### Scenario: Inferred nested field is one the rows carry
- **WHEN** `fromJson` infers a dotted field from a nested object
- **THEN** materialising a row from that same object produces a column of exactly that name

#### Scenario: Schema and rows agree on colliding dotted paths
- **WHEN** a sampled object contains both a literal dotted key and a nested path that generate the same dotted path (for example `{ "a.b": 1, "a": { "b": 2 } }`)
- **THEN** the inferred schema contains exactly one field of that path, and the materialised row contains exactly one column of that path, with no duplicate-named field reaching the schema

#### Scenario: A path that is a scalar in one object and a subtree in another yields both paths
- **WHEN** one sampled object has `{ "a": 1 }` and another has `{ "a": { "b": 2 } }`
- **THEN** the inferred schema contains BOTH a field `a` and a field `a.b`, each typed from only the values seen at that path, and neither path is dropped or collapsed into the other

#### Scenario: Schema field set is the union of the rows' column sets
- **WHEN** `fromJson` infers a schema over an array of objects of differing shapes
- **THEN** every materialised row's column set is a subset of the schema's field-name set, and the schema's field-name set is exactly the union of all the rows' column sets

#### Scenario: Array field is inferred as a string leaf
- **WHEN** `fromJson` is called with `{ "tags": ["a", "b"] }`
- **THEN** the result contains a single field `tags` of type `StringType`, and no `tags.0` field

#### Scenario: Null value marks field as nullable
- **WHEN** a field is `JsNull` in any sampled object
- **THEN** that field is marked `nullable = true`

#### Scenario: Absence of a key does not by itself mark a field nullable
- **WHEN** a path is present and non-null in one sampled object and simply absent from another
- **THEN** the field is inferred as non-nullable, unchanged from prior behaviour

#### Scenario: Float vs integer distinction
- **WHEN** a numeric field value is `1` (no decimal)
- **THEN** it is inferred as `IntegerType`
- **WHEN** a numeric field value is `1.5` (with decimal)
- **THEN** it is inferred as `FloatType`

#### Scenario: String matching timestamp pattern infers TimestampType
- **WHEN** a string field value matches ISO-8601 date or datetime format (e.g. `"2024-01-15"`, `"2024-01-15T10:30:00Z"`)
- **THEN** the field is inferred as `TimestampType`

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

### Requirement: DataFieldType sealed type
The `DataFieldType` sealed trait SHALL define seven variants: `StringType`, `IntegerType`,
`FloatType`, `BooleanType`, `TimestampType`, `StringBodyType`, `BinaryRefType`. An `asString`
method SHALL return the canonical lowercase/hyphenated string representation used for storage in
`DataField.dataType`. The first five are `Structured` field types; `StringBodyType` and
`BinaryRefType` are `Content` field types (see the `type-registry-content-fields` capability for
the `FieldTypeCategory` classifier and the content-type value-representation contract).

#### Scenario: asString produces canonical names
- **WHEN** `DataFieldType.asString` is called on each variant
- **THEN** it returns `"string"`, `"integer"`, `"float"`, `"boolean"`, `"timestamp"`,
  `"string-body"`, `"binary-ref"` respectively

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

### Requirement: POST /api/sources/infer — preview REST API schema without persisting
The API SHALL expose `POST /api/sources/infer` that accepts a `RestApiConfigPayload` JSON body, fetches the remote endpoint, infers the schema via `SchemaInferenceEngine.fromJson`, and returns an `InferredSchemaResponse` with inferred fields. No `DataSource` or `Output` is written to the database. If the remote fetch fails, the API returns `502 Bad Gateway` with an error message.

#### Scenario: Successful REST infer returns fields
- **WHEN** `POST /api/sources/infer` is called with a valid REST config pointing to a live endpoint
- **THEN** the response is 200 with `{"fields": [...]}` where each field has `name`, `displayName`, `dataType`, `nullable`

#### Scenario: Connector failure returns 502
- **WHEN** the REST API connector cannot reach the target URL
- **THEN** the response is 502 with `{"error": "Fetch failed: ..."}`

#### Scenario: Invalid config returns 400
- **WHEN** `POST /api/sources/infer` is called with a malformed config (e.g. missing `url`)
- **THEN** the response is 400 with an error message

### Requirement: POST /api/data-sources/infer — preview CSV schema without persisting
The API SHALL expose `POST /api/data-sources/infer` that accepts a multipart form upload with a `file` field (CSV content), infers the schema via `SchemaInferenceEngine.fromCsv`, and returns an `InferredSchemaResponse`. No `DataSource` or `Output` is written to the database. If the file is missing or not UTF-8, the API returns `400 Bad Request`.

#### Scenario: Valid CSV returns inferred fields
- **WHEN** `POST /api/data-sources/infer` is called with a valid UTF-8 CSV file
- **THEN** the response is 200 with `{"fields": [...]}` reflecting the CSV column types

#### Scenario: Missing file returns 400
- **WHEN** `POST /api/data-sources/infer` is called with no `file` field in the multipart form
- **THEN** the response is 400 with an error message

### Requirement: InferredSchemaResponse wire format
`POST /api/sources/infer` and `POST /api/data-sources/infer` SHALL both return the same response envelope: `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`.

#### Scenario: Both infer endpoints return the same envelope
- **WHEN** `POST /api/sources/infer` and `POST /api/data-sources/infer` are each called
- **THEN** both return the same response envelope
  `{ "fields": [{ "name": string, "displayName": string, "dataType": string, "nullable": boolean }] }`

### Requirement: Static connector uses declared column types without inference
For static data sources, the system SHALL construct `DataField` entries directly from the user-declared `columns` array (`{ name, type }`) rather than running `SchemaInferenceEngine`. The declared `type` value SHALL be mapped to the corresponding `SchemaFieldType` string. An unrecognised type string SHALL default to `"string"`.

#### Scenario: Declared integer type is preserved
- **WHEN** a static source is created with a column declared as `{ "name": "count", "type": "integer" }`
- **THEN** the registered `Output` contains a field `count` with `dataType = "integer"`

#### Scenario: Declared boolean type is preserved
- **WHEN** a static source is created with a column declared as `{ "name": "active", "type": "boolean" }`
- **THEN** the registered `Output` contains a field `active` with `dataType = "boolean"`

#### Scenario: Unrecognised type defaults to string
- **WHEN** a static source column is declared with an unrecognised type string
- **THEN** the registered field has `dataType = "string"`

### Requirement: JSON type widening across sampled objects
When a dotted leaf path carries values of differing inferred types across sampled objects, `fromJson` SHALL infer the single narrowest type that accommodates every sampled non-null value for that path. The widening operation SHALL be a commutative, associative, idempotent join over the per-value inferred types, so that the inferred type is a function of the SET of sampled values and never of the order in which they are encountered. The join SHALL be defined as: two equal types join to themselves; `IntegerType` joined with `FloatType` is `FloatType`; `TimestampType` joined with `StringType` is `StringType`; and every other pair of distinct types joins to `StringType`. `StringType` SHALL therefore be the top of the lattice and SHALL absorb any genuinely mixed pairing (for example a number joined with a boolean). `JsNull` values SHALL contribute only nullability and SHALL NOT participate in widening. A path whose every sampled value is `JsNull` SHALL infer as `StringType`, nullable.

This lattice deliberately DIFFERS from the sequential widening order the CSV inference path uses. The CSV path widens a running type against a raw string cell and is not commutative — it widens `IntegerType` to `BooleanType` on encountering `"true"`, so a mixed numeric/boolean CSV column infers as boolean while the equivalent JSON column infers as `StringType` under this requirement. The CSV path's behaviour is unchanged by this capability; only JSON inference is specified here.

#### Scenario: Integral first, fractional later widens to float
- **WHEN** a path's sampled values are `3` in the first object and `2.5` in a later object
- **THEN** the field is inferred as `FloatType`

#### Scenario: Fractional first, integral later stays float
- **WHEN** a path's sampled values are `2.5` in the first object and `3` in a later object
- **THEN** the field is inferred as `FloatType`

#### Scenario: Mixed scalar kinds fall back to string
- **WHEN** a path's sampled values include both a number and a non-timestamp string
- **THEN** the field is inferred as `StringType`

#### Scenario: A number mixed with a boolean falls back to string
- **WHEN** a path's sampled values are `1` in one object and `true` in another
- **THEN** the field is inferred as `StringType`, and NOT as `BooleanType`

#### Scenario: Widening is order-independent for any pair
- **WHEN** the same two differing values are supplied to `fromJson` in either order
- **THEN** the inferred type for that path is the same in both cases

#### Scenario: A timestamp string mixed with a non-timestamp string is a string
- **WHEN** a path's sampled values are `"2024-01-15"` in one object and `"not a date"` in another
- **THEN** the field is inferred as `StringType`

#### Scenario: Nulls do not narrow or widen a type
- **WHEN** a path's sampled values are `JsNull` in one object and `2.5` in another
- **THEN** the field is inferred as `FloatType` and `nullable = true`

#### Scenario: A null alongside integral values yields a nullable integer, not a string
- **WHEN** a path's sampled values are `JsNull` in one object and `7` in another
- **THEN** the field is inferred as `IntegerType` with `nullable = true`
- **AND** it is NOT inferred as `StringType`, which is what the presence of a single null previously forced regardless of the other sampled values

#### Scenario: All-null path is a nullable string
- **WHEN** a path is `JsNull` in every sampled object
- **THEN** the field is inferred as `StringType` with `nullable = true`

#### Scenario: No truncation on materialisation of a widened column
- **WHEN** a column widened to `FloatType` is materialised from rows whose values include fractional numbers
- **THEN** the fractional values are carried through without truncation to whole numbers

### Requirement: Order-independent JSON schema inference
The `InferredSchema` produced by `fromJson` over a `JsArray` of objects SHALL be a function of the set of sampled objects alone and SHALL NOT depend on their order. Inferring over any permutation of the same elements SHALL produce an identical schema: the same field paths, each with the same type, the same nullability, and the same display name, in the same sequence.

#### Scenario: Permuted input yields an identical schema
- **WHEN** `fromJson` is called twice over the same heterogeneous array of objects, the second time with the elements in a different order
- **THEN** both calls return equal `InferredSchema` values

#### Scenario: Reversing a mixed-shape array does not change the field set
- **WHEN** an array whose elements have differing nested shapes and differing numeric precisions is reversed
- **THEN** the inferred field paths and their types are unchanged
