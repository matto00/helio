## ADDED Requirements

### Requirement: Type Registry list indicates unstructured DataTypes
The Type Registry sidebar list SHALL render a visually distinct badge next to any DataType whose
`fields` include at least one content field (`string-body` or `binary-ref`, per
`FieldTypeCategory.Content`). DataTypes with no content fields SHALL render no such badge.

#### Scenario: DataType with a content field shows the badge
- **WHEN** the Type Registry list renders a DataType that has at least one field with
  `dataType` equal to `"string-body"` or `"binary-ref"`
- **THEN** that DataType's row shows the unstructured-type badge

#### Scenario: Purely structured DataType shows no badge
- **WHEN** the Type Registry list renders a DataType whose `fields` are all structured
  (`string`, `integer`, `float`, `boolean`, `timestamp`)
- **THEN** that DataType's row shows no unstructured-type badge

#### Scenario: Classification ignores computed fields
- **WHEN** a DataType has no content-typed `fields` but has a `computedFields` entry
- **THEN** that DataType's row shows no unstructured-type badge (classification is based on
  `fields`, not `computedFields`)
