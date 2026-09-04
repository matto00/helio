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
                $ref: "../../schemas/pipelines/pipeline-analyze-response.schema.json"
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

### Requirement: GET /api/pipelines/:id/analyze returns pipeline with per-step schemas
The API SHALL expose `GET /api/pipelines/:id/analyze`. The response SHALL include the pipeline summary fields
(`id`, `name`, `sourceDataSourceName`, `outputDataTypeName`, and the retired `output_data_type_id` field), a `sourceSchema` array, and a
`steps` array. Each step SHALL include its `id`, `position`, `type` (discriminator), `config` (typed object
matching the discriminator), `inputSchema`, and `outputSchema` (CS2c-3a wire shape — `config` is no longer a
stringified JSON blob). Step 0's `inputSchema` SHALL equal `sourceSchema`. Step N's `inputSchema` SHALL equal
step N-1's `outputSchema`. If the pipeline is not found, the response SHALL be 404.

#### Scenario: Empty step list returns pipeline with empty steps and populated sourceSchema
- **WHEN** `GET /api/pipelines/:id/analyze` is called for a pipeline with no steps and a source Output
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

#### Scenario: Compute step appends declared output using unified config shape
- **WHEN** a compute step has `config: {"column": "total", "expression": "price * qty", "type": "number"}` applied to
  inputSchema `[{name: "price", type: "number"}, {name: "qty", type: "number"}]`
- **THEN** the step's `outputSchema` is `[{name: "price", type: "number"}, {name: "qty", type: "number"}, {name: "total", type: "number"}]`

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
Analyze SHALL derive a source schema **per root**, from that root's bound DataSource. The response SHALL carry one source-schema entry per root, keyed by root id.

#### Scenario: A two-root pipeline analyzes both source schemas
- **WHEN** analyze is called on a pipeline with two roots bound to sources with different fields
- **THEN** the response carries a source schema for each root, keyed by that root's id

#### Scenario: Source DataType fields populate sourceSchema
- **WHEN** the source DataSource has a registered Output with fields `[{name: "col1", dataType: "string"}]`
- **THEN** `sourceSchema` in the analyze response is `[{name: "col1", type: "string"}]`

#### Scenario: Missing source DataType produces empty sourceSchema
- **WHEN** the source DataSource has no registered Output (no Output with matching sourceId)
- **THEN** `sourceSchema` is `[]` and the response is still 200

### Requirement: JSON Schema and OpenAPI spec for analyze response
A JSON Schema file SHALL be added at `schemas/pipeline-analyze-response.json` describing the analyze response
shape. The OpenAPI spec SHALL include the `GET /api/pipelines/{id}/analyze` operation. `npm run check:schemas`
SHALL pass after the change.

#### Scenario: check:schemas passes with new schema file
- **WHEN** `npm run check:schemas` is executed after adding `pipeline-analyze-response.json`
- **THEN** the command exits with code 0

### Requirement: Analyze response surfaces source-schema drift

The `GET /api/pipelines/:id/analyze` response SHALL include an optional `sourceSchemaDrift` object computed at
analyze time by diffing the current source schema against the pipeline's persisted `last_source_schema`
baseline. The field SHALL be absent when there is no baseline (no successful run yet) or no drift. When
present, it SHALL contain `addedColumns` and `removedColumns` (arrays of `{name, type}`) and
`typeChangedColumns` (array of `{name, previousType, currentType}`). The field SHALL be additive and optional
in `schemas/pipelines/pipeline-analyze-response.schema.json` (not in `required`) so existing consumers are unaffected. A
malformed persisted baseline SHALL be treated as no baseline (no drift reported, no error).

#### Scenario: No baseline yields absent field
- **WHEN** `GET /api/pipelines/:id/analyze` is called for a pipeline that has never run successfully
- **THEN** the 200 response contains no `sourceSchemaDrift` member

#### Scenario: Drift since last successful run is reported
- **WHEN** a pipeline last ran successfully with source schema `[{a, string}, {b, number}]` and the source's
  current schema is `[{a, string}]`
- **THEN** the analyze response includes `sourceSchemaDrift.removedColumns: [{name: "b", type: "number"}]`

#### Scenario: Unchanged schema yields absent field
- **WHEN** a pipeline's current source schema equals its persisted baseline
- **THEN** the 200 response contains no `sourceSchemaDrift` member

### Requirement: Analyze projects a schema per node, including every tail
Analyze SHALL project a schema for every node in every lane across every root. A root-level node's input schema SHALL be its own root's source schema.

#### Scenario: Nodes in both roots' lanes are projected
- **WHEN** analyze is called on a pipeline with a lane under each of two roots
- **THEN** every node in both lanes carries a projected schema derived from its own root's source schema

#### Scenario: Analyze works at a node in a non-first lane
- **WHEN** analyze is requested for a node in the second of two sibling lanes
- **THEN** a schema is projected for that node
- **THEN** no structural-validation error is raised

#### Scenario: Rejoin schema is projected from both lanes
- **WHEN** analyze is requested for a `union` step whose parent lane projects columns `{a, b}` and whose `lane`-kind secondary input's referenced node projects `{a, c}`
- **THEN** the projected schema reflects both inputs per the configured mode, rather than the parent lane alone

#### Scenario: A source-kind secondary input falls back to best-effort projection
- **WHEN** analyze is requested for a `union` step whose `secondaryInput` is `source`-kind
- **THEN** the projected schema is the parent lane's schema unchanged, and no validation error is raised
- **THEN** the secondary data source's schema is not resolved — see HEL-965

#### Scenario: A pipeline with one tail has two node projections
- **WHEN** `GET /api/pipelines/:id/analyze` is called on a pipeline with a trunk and one tail
  branching from it
- **THEN** the response includes a projected schema for the trunk's final step and a separate
  projected schema for the tail's final step

#### Scenario: Per-node projection reflects that node's own step chain only
- **WHEN** a tail applies a `select` step dropping a column present on the trunk
- **THEN** the tail's node projection excludes that column while the trunk's projection still
  includes it
