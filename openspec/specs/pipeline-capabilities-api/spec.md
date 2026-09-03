# pipeline-capabilities-api Specification

## Purpose
Tell a caller which Output kinds and field-mapping slots are bindable at a given pipeline node,
so the frontend and helio-mcp can offer only valid choices instead of failing at bind time.

## Requirements

### Requirement: GET /api/pipelines/:id/capabilities?stepId= reports bindable Output kinds/slots
The endpoint SHALL return the bindable Output kinds and slots for any node in the graph, evaluated against that node's projected schema, regardless of which lane the node belongs to. For a rejoin step, eligibility SHALL be evaluated against the schema projected from both of its inputs.

#### Scenario: Capabilities at a node inside a lane
- **WHEN** capabilities are requested for a node in a lane hanging off a multi-child parent
- **THEN** the response describes the Output kinds bindable at that node
- **THEN** no structural-validation error is raised

#### Scenario: Capabilities at a rejoin node reflect the rejoined schema
- **WHEN** capabilities are requested for a rejoin step
- **THEN** eligibility is evaluated against the schema projected from both of its inputs

#### Scenario: Node with only numeric columns supports metric and chart Outputs
- **WHEN** the projected schema at a node has two numeric columns and no string columns
- **THEN** the response includes `metric` and `chart` in the bindable kinds and excludes any kind
  requiring a categorical/label slot with no eligible column

#### Scenario: Unknown stepId is 404
- **WHEN** `stepId` does not identify a step on the pipeline
- **THEN** the response is `404 Not Found`

### Requirement: Field-type values reported are always the seven canonical DataFieldType strings
Every column type value returned by this endpoint SHALL be one of the seven canonical
`DataFieldType` wire values; aggregate columns (`sum`/`avg`/`running_sum`) SHALL be reported as
`integer` or `float` by the aggregate's stated rule, never `"number"` or `"double"`.

#### Scenario: A sum aggregate column is reported as a canonical numeric type
- **WHEN** the node's projected schema includes a column produced by a `sum` aggregate over an
  integer field
- **THEN** the reported type for that column is `integer` (or `float` if the summed field was a
  float), never `"number"`

### Requirement: Columns produced by a select step are retained in the projected schema
A `select` step's output columns SHALL appear in the node's projected schema and SHALL be eligible
for field-mapping slots exactly like any other column — a `select` step SHALL NOT cause numeric
columns to be dropped from capability reporting.

#### Scenario: A select-produced numeric column is bindable
- **WHEN** a node's most recent step is a `select` that includes a numeric column
- **THEN** that column appears in the projected schema and is eligible for a numeric slot
