## MODIFIED Requirements

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
