## MODIFIED Requirements

### Requirement: Get single DataType
The backend SHALL expose `GET /api/types/:id` returning the full DataType including all fields and all computed fields.

#### Scenario: Found
- **WHEN** `GET /api/types/:id` is called with a valid id
- **THEN** the response is 200 with the full DataType object including a `computedFields` array (empty if none defined)

#### Scenario: Not found
- **WHEN** `GET /api/types/:id` is called with an unknown id
- **THEN** the response is 404

### Requirement: Update DataType
The backend SHALL expose `PATCH /api/types/:id` accepting an optional `name`, optional `fields` array, and optional `computedFields` array. All provided fields SHALL be updated; version SHALL be incremented on every successful update. If `computedFields` contains an entry with an invalid expression, the entire request SHALL be rejected with 400 and no changes persisted.

#### Scenario: Name updated
- **WHEN** `PATCH /api/types/:id` is called with `{ "name": "New Name" }`
- **THEN** the response is 200 with the updated DataType and incremented version

#### Scenario: Computed fields updated
- **WHEN** `PATCH /api/types/:id` is called with a valid `computedFields` array
- **THEN** the response is 200 with the updated DataType containing the new computed fields

#### Scenario: Invalid computed field expression returns 400
- **WHEN** `PATCH /api/types/:id` is called with a `computedFields` entry whose `expression` is syntactically invalid
- **THEN** the response is 400 with a descriptive `message` and the DataType is not modified

#### Scenario: Not found returns 404
- **WHEN** `PATCH /api/types/:id` is called with an unknown id
- **THEN** the response is 404

## ADDED Requirements

### Requirement: Validate expression against DataType fields
The backend SHALL expose `GET /api/types/:id/validate-expression?expr=<expression>` returning a validation result without persisting any changes. The response SHALL always be 200 (the validity is conveyed in the body), unless the DataType is not found (404).

#### Scenario: Valid expression returns valid true
- **WHEN** `GET /api/types/:id/validate-expression?expr=price * quantity` is called and both fields exist
- **THEN** the response is 200 with `{ "valid": true }`

#### Scenario: Syntax error returns valid false with message
- **WHEN** `GET /api/types/:id/validate-expression?expr=price **` is called
- **THEN** the response is 200 with `{ "valid": false, "message": "<description>" }`

#### Scenario: Unknown field reference returns valid false with message
- **WHEN** `GET /api/types/:id/validate-expression?expr=nonexistent * 2` is called
- **THEN** the response is 200 with `{ "valid": false, "message": "Unknown field: nonexistent" }`

#### Scenario: DataType not found returns 404
- **WHEN** `GET /api/types/:id/validate-expression` is called with an unknown id
- **THEN** the response is 404
