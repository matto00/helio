# pipeline-analyze-api Specification

## Purpose

Provide schema-inference results for every step in a pipeline without running the pipeline.
The analyze endpoint returns the pipeline summary plus an ordered list of steps, where each step
carries its `inputSchema` and `outputSchema` (arrays of `{ name, type }` objects).  The
`sourceSchema` reflects the fields exposed by the bound DataSource.

## OpenAPI Operation

```yaml
paths:
  /api/pipelines/{id}/analyze:
    get:
      summary: Analyze pipeline schema
      operationId: analyzePipeline
      tags: [pipelines]
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: string
      responses:
        "200":
          description: Pipeline with per-step inferred schemas
          content:
            application/json:
              schema:
                $ref: "../../schemas/pipeline-analyze-response.schema.json"
        "404":
          description: Pipeline not found
          content:
            application/json:
              schema:
                type: object
                required: [message]
                properties:
                  message:
                    type: string
        "500":
          description: Internal server error
```
## Requirements
### Requirement: GET /api/pipelines/{id}/analyze returns pipeline with step schemas
The backend SHALL expose `GET /api/pipelines/{id}/analyze`. The response SHALL include:
- Pipeline summary fields: `id`, `name`, `sourceDataSourceName`, `outputDataTypeName`, `outputDataTypeId`
- `sourceSchema`: array of `{ name, type }` derived from the bound DataSource's DataType fields
- `steps`: ordered array of steps, each carrying `inputSchema`, `outputSchema`, and optional `validationError`

Step 0's `inputSchema` equals `sourceSchema`. Step N's `inputSchema` equals step N-1's `outputSchema`.

#### Scenario: Returns 404 for unknown pipeline id
- **WHEN** `GET /api/pipelines/nonexistent/analyze` is called
- **THEN** the response is `404 Not Found`

#### Scenario: Empty step list returns sourceSchema only
- **WHEN** a pipeline with no steps is analyzed
- **THEN** `steps` is an empty array and `sourceSchema` reflects the DataSource's fields

#### Scenario: Select step filters fields
- **WHEN** a pipeline has a select step with `fields: ["order_id"]` and the source has fields `order_id, amount`
- **THEN** the select step's `outputSchema` contains only `order_id`

#### Scenario: Rename cascades to subsequent steps
- **WHEN** a pipeline has a rename step (renames `order_id` → `id`) followed by a select step
- **THEN** the select step's `inputSchema` uses the renamed field name `id`

#### Scenario: Malformed config returns validationError and treats step as identity
- **WHEN** a step has an unparseable JSON config
- **THEN** `validationError` is set on that step and `outputSchema` equals `inputSchema`

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

#### Scenario: Cast step changes field type
- **WHEN** a cast step has `config: {"column": "amount", "dataType": "string"}` applied to
  inputSchema `[{name: "amount", type: "number"}]`
- **THEN** the step's `outputSchema` is `[{name: "amount", type: "string"}]`

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

### Requirement: Source schema derived from bound DataSource's registered DataType fields
The analyze endpoint SHALL derive `sourceSchema` from the `DataType` that is linked to the pipeline's
`sourceDataSourceId` via `DataType.sourceId`. Each `DataField` SHALL be represented as `{name, type}` in
`sourceSchema`, where `type` is the `DataField.dataType` string value. If no source DataType is found,
`sourceSchema` SHALL be an empty array.

#### Scenario: Source DataType fields populate sourceSchema
- **WHEN** the source DataSource has a registered DataType with fields `[{name: "col1", dataType: "string"}]`
- **THEN** `sourceSchema` in the analyze response is `[{name: "col1", type: "string"}]`

#### Scenario: Missing source DataType produces empty sourceSchema
- **WHEN** the source DataSource has no registered DataType (no DataType with matching sourceId)
- **THEN** `sourceSchema` is `[]` and the response is still 200

### Requirement: JSON Schema and OpenAPI spec for analyze response
A JSON Schema file SHALL be added at `schemas/pipeline-analyze-response.json` describing the analyze response
shape. The OpenAPI spec SHALL include the `GET /api/pipelines/{id}/analyze` operation. `npm run check:schemas`
SHALL pass after the change.

#### Scenario: check:schemas passes with new schema file
- **WHEN** `npm run check:schemas` is executed after adding `pipeline-analyze-response.json`
- **THEN** the command exits with code 0

