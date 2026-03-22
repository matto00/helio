## ADDED Requirements

### Requirement: DataTypeRepository can check if a type is bound to any panel
The `DataTypeRepository` SHALL expose `isBoundToAnyPanel(id: DataTypeId): Future[Boolean]` that returns `true` if one or more panels have `type_id = id`.

#### Scenario: Unbound type returns false
- **WHEN** `isBoundToAnyPanel` is called for a type with no bound panels
- **THEN** it returns `false`

#### Scenario: Bound type returns true
- **WHEN** at least one panel has `type_id` set to the given DataTypeId
- **THEN** `isBoundToAnyPanel` returns `true`
