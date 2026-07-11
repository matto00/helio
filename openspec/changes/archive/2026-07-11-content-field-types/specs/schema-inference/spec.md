## MODIFIED Requirements

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
