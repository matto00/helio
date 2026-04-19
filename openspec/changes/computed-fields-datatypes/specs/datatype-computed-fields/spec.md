## ADDED Requirements

### Requirement: Computed fields are stored on a DataType
The backend SHALL store zero or more computed field definitions on each DataType. Each computed field SHALL have: `name` (string, unique within the type), `displayName` (string), `expression` (string), and `dataType` (one of `string`, `integer`, `float`, `boolean`).

#### Scenario: DataType created with no computed fields defaults to empty list
- **WHEN** a DataType is created without a `computedFields` payload
- **THEN** the stored DataType has `computedFields: []`

#### Scenario: DataType stores provided computed fields
- **WHEN** `PATCH /api/types/:id` is called with a valid `computedFields` array
- **THEN** the DataType is updated with the provided computed fields and the response includes them

### Requirement: Expression evaluator supports arithmetic operators and field references
The backend SHALL evaluate computed field expressions per row. The evaluator SHALL support: numeric arithmetic (`+`, `-`, `*`, `/`), field references by name (resolved from the current row), string concatenation (`+` on string operands), and parenthesised sub-expressions.

#### Scenario: Arithmetic expression is evaluated correctly
- **WHEN** a row contains `{ "price": 10, "quantity": 3 }` and a computed field has `expression: "price * quantity"`
- **THEN** the computed field value in the row is `30`

#### Scenario: String concatenation is evaluated correctly
- **WHEN** a row contains `{ "first": "Hello", "last": "World" }` and a computed field has `expression: "first + \" \" + last"`
- **THEN** the computed field value is `"Hello World"`

#### Scenario: Division by zero yields null and does not crash
- **WHEN** an expression evaluates to division by zero at runtime
- **THEN** the computed field value for that row is `null` and the response includes a descriptive entry in `evaluationErrors`

#### Scenario: Unknown field reference yields null and does not crash
- **WHEN** an expression references a field name that does not exist in the row
- **THEN** the computed field value for that row is `null` and the response includes a descriptive entry in `evaluationErrors`

### Requirement: Computed field values are appended to preview rows
When the backend serves preview rows for a DataType, it SHALL evaluate all computed fields against each row and append the results as additional fields in the row object.

#### Scenario: Preview rows include computed field values
- **WHEN** `GET /api/data-sources/:id/sources` returns rows for a DataType that has a computed field `total = price * quantity`
- **THEN** each row in the response contains a `total` key with the evaluated value

#### Scenario: Regular fields are unaffected by computed field evaluation
- **WHEN** computed fields are evaluated for a row
- **THEN** the original raw field values in the row are unchanged

### Requirement: Invalid expressions are rejected with a descriptive error
The backend SHALL validate expressions when they are saved (via PATCH). A parse error or reference to a disallowed construct SHALL return 400 with a `message` field describing the problem.

#### Scenario: Malformed expression returns 400
- **WHEN** `PATCH /api/types/:id` is called with a computed field whose expression is syntactically invalid (e.g. `price **`)
- **THEN** the response is 400 with a descriptive `message` and the DataType is not updated

#### Scenario: Expression exceeding maximum length returns 400
- **WHEN** `PATCH /api/types/:id` is called with a computed field expression longer than 500 characters
- **THEN** the response is 400

### Requirement: Expression validation endpoint
The backend SHALL expose `GET /api/types/:id/validate-expression?expr=<expression>` to validate an expression against the DataType's field names without persisting any changes.

#### Scenario: Valid expression returns 200
- **WHEN** `GET /api/types/:id/validate-expression?expr=price * quantity` is called and both `price` and `quantity` are field names on the DataType
- **THEN** the response is 200 with `{ "valid": true }`

#### Scenario: Invalid expression syntax returns 200 with error detail
- **WHEN** `GET /api/types/:id/validate-expression?expr=price **` is called
- **THEN** the response is 200 with `{ "valid": false, "message": "<description>" }`

#### Scenario: Unknown field reference returns 200 with error detail
- **WHEN** `GET /api/types/:id/validate-expression?expr=nonexistent * 2` is called and `nonexistent` is not a field on the DataType
- **THEN** the response is 200 with `{ "valid": false, "message": "<description>" }`
