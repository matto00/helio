## MODIFIED Requirements

### Requirement: JSON schema inference
The `SchemaInferenceEngine.fromJson` function SHALL accept a `spray.json.JsValue` and return an `InferredSchema`. If the root value is a `JsArray` of objects, fields are inferred from the union of keys across all elements. If the root is a `JsObject`, fields are inferred directly from its keys. Nested `JsObject` values SHALL be flattened using dot notation, via the shared bounded traversal defined by the `nested-json-flattening` capability — the same traversal from which rows are materialised, so an inferred dotted field is always a field the rows actually carry. Array values SHALL be leaves, inferred as `StringType`, and SHALL NOT be expanded into index-bearing field names. An object at the traversal's depth bound SHALL be inferred as a single `StringType` field at its dotted path. All other root shapes return an empty schema.

#### Scenario: Root object infers fields from keys
- **WHEN** `fromJson` is called with a `JsObject` containing keys `id` (number), `name` (string), `active` (boolean)
- **THEN** the result contains fields `id: IntegerType`, `name: StringType`, `active: BooleanType`, all non-nullable

#### Scenario: Root array infers union of keys
- **WHEN** `fromJson` is called with a `JsArray` of two objects where one has key `x` and another has keys `x` and `y`
- **THEN** the result contains both `x` and `y` fields

#### Scenario: Nested object is flattened with dot notation
- **WHEN** `fromJson` is called with `{ "address": { "city": "London" } }`
- **THEN** the result contains a field named `address.city` of type `StringType`

#### Scenario: Inferred nested field is one the rows carry
- **WHEN** `fromJson` infers a dotted field from a nested object
- **THEN** materialising a row from that same object produces a column of exactly that name

#### Scenario: Array field is inferred as a string leaf
- **WHEN** `fromJson` is called with `{ "tags": ["a", "b"] }`
- **THEN** the result contains a single field `tags` of type `StringType`, and no `tags.0` field

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
