## MODIFIED Requirements

### Requirement: GET /api/pipelines/:id/analyze returns pipeline with per-step schemas
The API SHALL expose `GET /api/pipelines/:id/analyze`. The response SHALL include the pipeline summary fields
(`id`, `name`, `sourceDataSourceName`, `outputDataTypeName`, `outputDataTypeId`), a `sourceSchema` array, and a
`steps` array. Each step SHALL include its `id`, `position`, `op`, `config`, `inputSchema`, and `outputSchema`.
Step 0's `inputSchema` SHALL equal `sourceSchema`. Step N's `inputSchema` SHALL equal step N-1's `outputSchema`.
If the pipeline is not found, the response SHALL be 404.

#### Scenario: Empty step list returns pipeline with empty steps and populated sourceSchema
- **WHEN** `GET /api/pipelines/:id/analyze` is called for a pipeline with no steps and a source DataType
  with fields `[{name: "a", type: "string"}]`
- **THEN** the response is 200 with `sourceSchema: [{name: "a", type: "string"}]` and `steps: []`

#### Scenario: Select step filters outputSchema to chosen fields
- **WHEN** a pipeline has one select step with `config: {"fields": ["order_id", "amount"]}` and
  sourceSchema `[{name: "order_id", type: "string"}, {name: "amount", type: "number"}, {name: "created_at", type: "string"}]`
- **THEN** that step's `inputSchema` equals the sourceSchema and `outputSchema` is
  `[{name: "order_id", type: "string"}, {name: "amount", type: "number"}]`

#### Scenario: Rename step replaces field names per mappings
- **WHEN** a rename step has `config: {"mappings": [{"from": "order_id", "to": "id"}]}` applied to
  inputSchema `[{name: "order_id", type: "string"}, {name: "amount", type: "number"}]`
- **THEN** the step's `outputSchema` is `[{name: "id", type: "string"}, {name: "amount", type: "number"}]`

#### Scenario: Cast step changes field type using casts map
- **WHEN** a cast step has `config: {"casts": {"amount": "string"}}` applied to
  inputSchema `[{name: "amount", type: "number"}]`
- **THEN** the step's `outputSchema` is `[{name: "amount", type: "string"}]`

#### Scenario: Cast step with multiple fields changes each field type
- **WHEN** a cast step has `config: {"casts": {"qty": "integer", "price": "double"}}` applied to
  inputSchema `[{name: "qty", type: "string"}, {name: "price", type: "string"}]`
- **THEN** the step's `outputSchema` is `[{name: "qty", type: "integer"}, {name: "price", type: "double"}]`

#### Scenario: Filter step is identity
- **WHEN** a filter step is applied to inputSchema `[{name: "x", type: "integer"}]`
- **THEN** the step's `outputSchema` equals `[{name: "x", type: "integer"}]`

#### Scenario: Compute step appends declared outputs
- **WHEN** a compute step has `config: {"column": "total", "expression": "...", "outputType": "number"}` applied to
  inputSchema `[{name: "amount", type: "number"}]`
- **THEN** the step's `outputSchema` is `[{name: "amount", type: "number"}, {name: "total", type: "number"}]`

#### Scenario: Aggregate step produces groupBy fields plus aggregation aliases
- **WHEN** an aggregate step has `config: {"groupBy": ["region"], "aggColumn": "amount", "aggFunction": "sum", "alias": "total_amount"}`
  applied to inputSchema `[{name: "region", type: "string"}, {name: "amount", type: "number"}]`
- **THEN** the step's `outputSchema` is `[{name: "region", type: "string"}, {name: "total_amount", type: "number"}]`

#### Scenario: Limit step is identity
- **WHEN** a limit step is applied to any inputSchema
- **THEN** the step's `outputSchema` equals the inputSchema

#### Scenario: Sort step is identity
- **WHEN** a sort step is applied to any inputSchema
- **THEN** the step's `outputSchema` equals the inputSchema

#### Scenario: Renamed field cascades to downstream step inputSchema
- **WHEN** step 0 is a rename step that renames `order_id` to `id`, and step 1 is any step
- **THEN** step 1's `inputSchema` contains `id` (not `order_id`)

#### Scenario: Malformed config produces validationError and identity fallback
- **WHEN** a select step has a config that is not valid JSON or is missing the `fields` key
- **THEN** the step's response includes a non-null `validationError` string, and `outputSchema` equals `inputSchema`

#### Scenario: Pipeline not found returns 404
- **WHEN** `GET /api/pipelines/nonexistent-id/analyze` is called
- **THEN** the response is 404
