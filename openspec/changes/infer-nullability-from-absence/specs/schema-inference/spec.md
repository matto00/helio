## MODIFIED Requirements

### Requirement: CSV schema inference
The `SchemaInferenceEngine.fromCsv` function SHALL accept a raw CSV string (first row = headers), sample up to 100 data rows, and return an `InferredSchema`. Type detection SHALL use widening order: `IntegerType` → `FloatType` → `BooleanType` → `TimestampType` → `StringType`. Empty cells SHALL mark the field as nullable. A data row with fewer cells than there are headers SHALL be treated as supplying an empty cell for each missing trailing column, so a column absent from a ragged row is marked nullable — the CSV path therefore already honours absence as evidence of nullability, consistent with the JSON path's composed rule. The CSV path SHALL continue to conflate "present but empty" with "absent": both mark the column nullable. This is a deliberate, retained divergence from the JSON path, where an empty string is a present, non-null `StringType` value; CSV has no on-the-wire encoding that distinguishes the two. Parsing SHALL comply with RFC 4180: fields MAY be enclosed in double-quotes; a double-quote inside a quoted field is escaped as two consecutive double-quotes (`""`); both CRLF and LF line endings SHALL be accepted.

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

#### Scenario: Ragged short row marks its missing trailing columns nullable
- **WHEN** a CSV has three headers and one data row supplies only two cells
- **THEN** the third column is marked `nullable = true`, on the same absence-as-evidence basis the JSON path uses

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

## REMOVED Requirements

### Requirement: JSON schema inference

**Reason**: Restructured, not deleted. Nullability is lifted out of this requirement into its own `JSON nullability from absence or null` requirement, so the composed rule is stated in exactly one place. What remains — the field-path union, flattening, array/depth-bound leaf handling, and per-path typing — is re-stated below as `JSON schema field enumeration` with every one of those scenarios carried over verbatim. Its scenario `Absence of a key does not by itself mark a field nullable` is deliberately NOT carried over: it asserted the exact defect this change fixes, and leaving it in place beside the new rule would make the spec state two contradictory nullability rules. Its counterpart `Null value marks field as nullable` is likewise not carried over here because it is subsumed, verbatim in effect, by the new requirement's `Explicit null still marks a field nullable` scenario.

**Migration**: No consumer migration is required, and no persisted schema changes. `SchemaInferenceFacade.toSchemaFields` projects an `InferredField` to `SchemaField { name, type }` and drops `nullable` before it reaches `data_sources.inferred_schema`, so no stored source schema carries the flag at all. The flag is observable only on the `POST /api/sources/infer` and `POST /api/data-sources/infer` preview responses and on the workspace-context column projection, both of which recompute it from live inference on every call. A caller relying on a non-nullable claim for a sparsely-present column was relying on an assertion the sampled data never honoured.


## ADDED Requirements

### Requirement: JSON schema field enumeration
The `SchemaInferenceEngine.fromJson` function SHALL accept a `spray.json.JsValue` and return an `InferredSchema`. If the root value is a `JsArray` of objects, fields are inferred from the union of the dotted leaf paths of ALL elements — at every nesting level, not only the top level — so a path present in any sampled object appears in the schema regardless of that object's position in the array. If the root is a `JsObject`, fields are inferred directly from its leaf paths. Nested `JsObject` values SHALL be flattened using dot notation, via the shared bounded traversal defined by the `nested-json-flattening` capability — the same traversal from which rows are materialised, so an inferred dotted field is always a field the rows actually carry. Array values SHALL be leaves, inferred as `StringType`, and SHALL NOT be expanded into index-bearing field names. An object at the traversal's depth bound SHALL be inferred as a single `StringType` field at its dotted path. The type of each field SHALL be the widened type of that path's values across all sampled objects (see the JSON type widening requirement), not the type of the first value encountered. Nullability SHALL be determined by the composed absence-or-null rule (see the JSON nullability requirement). All other root shapes return an empty schema.

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

#### Scenario: Float vs integer distinction
- **WHEN** a numeric field value is `1` (no decimal)
- **THEN** it is inferred as `IntegerType`
- **WHEN** a numeric field value is `1.5` (with decimal)
- **THEN** it is inferred as `FloatType`

#### Scenario: String matching timestamp pattern infers TimestampType
- **WHEN** a string field value matches ISO-8601 date or datetime format (e.g. `"2024-01-15"`, `"2024-01-15T10:30:00Z"`)
- **THEN** the field is inferred as `TimestampType`

### Requirement: JSON nullability from absence or null
`fromJson` SHALL infer a path's nullability from a single composed rule, not from two independently-applied rules:

> A path is `nullable = true` if and only if at least one sampled object fails to supply a non-null value at that path.

An object fails to supply a non-null value at a path in exactly two ways, which SHALL be treated identically: the path is **absent** from that object's leaf enumeration, or the path is present with an explicit **`JsNull`** leaf. Equivalently, a path is `nullable = false` if and only if every sampled object carries a present, non-null value at it.

A third encoding, **present-but-empty** (a `JsString("")` leaf), SHALL NOT be treated as either of the above: it is a present, non-null value and contributes `StringType` to the widening join, exactly as any other string does. Absent, explicit-null, and present-but-empty are three distinct encodings and SHALL be specified and tested as three distinct cases.

Nullability SHALL remain a function of the SET of sampled objects and SHALL NOT depend on their order.

Absence SHALL contribute nothing to the widened **type** of a path, in either direction — an object that does not carry a path supplies no value at it, so there is no value to join. Inferred type is therefore unaffected by this requirement and is not subject to the same absence-blindness the nullability rule corrects; a path's type remains the join over exactly the present, non-null values, unchanged.

When the root value is a single `JsObject`, that object is the only sampled object, so every path it carries is supplied by every sampled object and is non-nullable unless its own leaf is `JsNull`.

#### Scenario: A path present in one object and absent from another is nullable
- **WHEN** `fromJson` is called with `[{ "a": 1, "b": 2 }, { "a": 3 }]`
- **THEN** field `b` is `nullable = true`
- **AND** field `a` is `nullable = false`

#### Scenario: A field present in 1 of 100 sampled rows is nullable
- **WHEN** `fromJson` is called with an array of 100 objects in which exactly one object carries a non-null value at `stats.rec` and the other 99 omit the path entirely
- **THEN** the inferred field `stats.rec` is `nullable = true`

#### Scenario: A nested path absent from a differently-shaped sibling row is nullable
- **WHEN** `fromJson` is called with a mixed-position payload in which a quarterback object carries `stats.pass_yd` but no `stats.rec`, and a receiver object carries `stats.rec`
- **THEN** both `stats.rec` and `stats.pass_yd` are `nullable = true`

#### Scenario: A field present and non-null in every sampled object stays non-nullable
- **WHEN** `fromJson` is called with an array of objects that every one of which carries a present, non-null value at a path
- **THEN** that field is `nullable = false`

#### Scenario: Explicit null still marks a field nullable
- **WHEN** a path is present with a `JsNull` leaf in at least one sampled object
- **THEN** that field is `nullable = true`

#### Scenario: Present-but-empty string is not null
- **WHEN** `fromJson` is called with an array in which every object carries the path with a value, and at least one of those values is the empty string `""`
- **THEN** that field is `nullable = false` and is inferred as `StringType`

#### Scenario: The three encodings are distinguished
- **WHEN** three separate arrays are inferred — one where a path is absent from some object, one where it is `JsNull` in some object, and one where it is `""` in some object but present in all
- **THEN** the first two yield `nullable = true` and the third yields `nullable = false`

#### Scenario: Nullability is order-independent
- **WHEN** `fromJson` is called over the same heterogeneous array of objects in two different orders
- **THEN** each field's `nullable` value is identical in both results

#### Scenario: Absence does not alter the inferred type
- **WHEN** a path is carried with integral values by some sampled objects and absent from the rest
- **THEN** the field is inferred as `IntegerType` with `nullable = true`, and NOT widened to `StringType` by the absence

#### Scenario: A path both absent and explicitly null is nullable once
- **WHEN** a path is absent from one sampled object, `JsNull` in another, and a number in a third
- **THEN** the field is `nullable = true` and typed from the numeric value alone

#### Scenario: A single root object's own keys stay non-nullable
- **WHEN** `fromJson` is called with a single `JsObject` whose keys all carry non-null values
- **THEN** every inferred field is `nullable = false`
