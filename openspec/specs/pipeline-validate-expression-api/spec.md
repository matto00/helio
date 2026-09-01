# pipeline-validate-expression-api Specification

## Purpose
Let a caller validate a compute/filter expression string against a pipeline node's schema before
saving a step, without a round trip through step creation and a failed run.

## Requirements

### Requirement: POST /api/pipelines/:id/validate-expression?stepId= validates an expression
The backend SHALL expose `POST /api/pipelines/:id/validate-expression?stepId=` (stepId absent =
pipeline root), accepting `{ expression: string }` and returning `{ valid: true }` or `{ valid:
false, error: string }` using the same `ExpressionEvaluator.validate` the pipeline engine already
uses for `compute`/`filter`/`assert` step validation, evaluated against the node's projected field
names. This replaces the dead `/api/types/:typeId/validate-expression` route (deleted with
`DataTypeRoutes` in P1.1, never replaced) that the frontend's `dataTypeService.ts` still calls.

#### Scenario: Valid expression against the node's fields
- **WHEN** `POST /api/pipelines/:id/validate-expression?stepId=<id>` is called with `{ "expression":
  "price * quantity" }` and both fields exist on that node's projected schema
- **THEN** the response is `200 OK` with `{ "valid": true }`

#### Scenario: Expression referencing an unknown field
- **WHEN** the expression references a field name not present on the node's projected schema
- **THEN** the response is `200 OK` with `{ "valid": false, "error": <descriptive message> }`

#### Scenario: Unknown stepId is 404
- **WHEN** `stepId` does not identify a step on the pipeline
- **THEN** the response is `404 Not Found`
