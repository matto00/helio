# pipeline-validate-expression-api Specification

## Purpose
Let a caller validate a compute expression string against a pipeline node's schema before
saving a step, without a round trip through step creation and a failed run.

## Requirements

### Requirement: POST /api/pipelines/:id/validate-expression?stepId= validates an expression
The backend SHALL expose `POST /api/pipelines/:id/validate-expression?stepId=` (stepId absent =
pipeline root), accepting `{ expression: string }` and returning `{ valid: true }` or `{ valid:
false, error: string }`. The verdict SHALL be exactly the one pipeline analyze gives an enabled
`compute` step that has that expression and a non-empty column, and whose input schema is the node's
projected schema. That covers the step's configuration check (a blank or unparseable expression), unknown
field names, AND expression type errors (for example a `coalesce` mixing numeric and text arguments, a
comparison between a number and text, or an `if()` whose branches have incompatible types). `valid`
SHALL be true exactly when analyze would report no `validationError` for that step. Otherwise `error`
SHALL be that `validationError`'s message, unchanged. `valid: false` means analyze would flag the
expression; it does not mean saving a step with that expression is rejected.

#### Scenario: Valid expression against the node's fields
- **WHEN** `POST /api/pipelines/:id/validate-expression?stepId=<id>` is called with `{ "expression":
  "$price * $quantity" }` and both fields exist on that node's projected schema
- **THEN** the response is `200 OK` with `{ "valid": true }`

#### Scenario: Expression referencing an unknown field
- **WHEN** the expression references a field name not present on the node's projected schema
- **THEN** the response is `200 OK` with `{ "valid": false, "error": <descriptive message> }`

#### Scenario: Unparseable expression reports analyze's message
- **WHEN** the expression does not parse
- **THEN** the response is `200 OK` with `{ "valid": false, "error": <message> }`, where `<message>` is the
  `validationError` analyze reports for a compute step with that expression

#### Scenario: Expression with a type error analyze rejects
- **WHEN** the expression parses and references only known fields but has a type error analyze
  reports for a compute step, such as `coalesce($amount, "n/a")` with `amount` numeric or
  `$amount > "10"` with `amount` numeric
- **THEN** the response is `200 OK` with `{ "valid": false, "error": <analyze's message> }`, and
  `error` equals the `validationError` analyze reports for a compute step with that expression at
  that node

#### Scenario: The client reads the same response shape the server sends
- **WHEN** the frontend's validate-expression client receives the server's response for a type-error
  expression
- **THEN** it surfaces `valid: false` and the same `error` text, verified against a response fixture
  the backend test also asserts

#### Scenario: Unknown stepId is 404
- **WHEN** `stepId` does not identify a step on the pipeline
- **THEN** the response is `404 Not Found`
