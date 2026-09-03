## ADDED Requirements

### Requirement: join, union and lookup take a discriminated secondary input
The `join`, `union` and `lookup` step configs SHALL each carry a `secondaryInput` object, which SHALL be exactly one of `{"kind": "source", "dataSourceId": "<id>"}` or `{"kind": "lane", "stepId": "<id>"}`. A `source`-kind input SHALL resolve to the rows of the named data source, preserving existing behaviour. A `lane`-kind input SHALL resolve to the post-evaluation frame of the named node in the same pipeline. No other shape SHALL be accepted.

#### Scenario: A union rejoins two lanes
- **WHEN** two lanes hang off one node and a `union` step in the first lane declares `{"kind": "lane", "stepId": "<node in the second lane>"}`
- **THEN** the union's output is the first lane's rows followed by the referenced node's rows, per the configured mode

#### Scenario: A join between two lanes produces joined rows
- **WHEN** a `join` step in one lane declares a `lane`-kind secondary input naming a node in another lane
- **THEN** the joined rows are produced from the two lanes' frames on the configured key, exactly as a source-kind join would from a source's rows

#### Scenario: A source-kind secondary input is unchanged
- **WHEN** a `join`, `union` or `lookup` step declares `{"kind": "source", "dataSourceId": "<id>"}`
- **THEN** its behaviour is identical to the pre-existing behaviour for that op against that data source

### Requirement: A lane reference may name any non-ancestor node, and a node may be referenced more than once
A `lane`-kind secondary input SHALL be permitted to name any node in the pipeline other than the referencing step itself and other than any of the referencing step's own ancestors. The named node is NOT REQUIRED to be the terminal node of its lane and is NOT REQUIRED to be materialized. Several rejoin steps MAY reference the same node.

#### Scenario: A mid-lane node may be referenced
- **WHEN** a rejoin step references a node that has a child of its own
- **THEN** the step is accepted at write time and the run consumes that node's post-evaluation frame

#### Scenario: A diamond is legal
- **WHEN** two separate rejoin steps each reference the same node
- **THEN** both are accepted at write time and both consume that node's frame in the same run
- **THEN** the referenced node is evaluated once

### Requirement: A lane reference forming a cycle is rejected at write time and at run time
The backend SHALL reject a `lane`-kind secondary input that names the referencing step itself or any of its ancestors. On `POST /api/pipelines/:id/steps` and on step update, the response SHALL be `400 Bad Request` and SHALL name the cycle; the step SHALL NOT be persisted. The engine SHALL additionally reject such a graph defensively at run time, so that a row reaching the table by any other path cannot produce a non-terminating or ill-defined walk.

#### Scenario: Self-reference rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names that same step
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: Ancestor reference rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names one of its own ancestors
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: A cyclic graph is rejected at run time
- **WHEN** a pipeline whose stored steps contain a lane-reference cycle is run
- **THEN** the run fails with a named error identifying the cycle
- **THEN** no step in the cycle is evaluated

### Requirement: A lane reference must name a step in the same pipeline
A `lane`-kind secondary input SHALL name a step belonging to the same pipeline. A `stepId` that does not exist, or that belongs to a different pipeline — including a pipeline owned by another user — SHALL be rejected at write time with a named error, and SHALL be rejected defensively at run time. This validation is a security boundary: it is the sole justification for applying no data-source ownership check on the lane branch, and cycle detection cannot substitute for it because a dangling or foreign id forms no cycle.

#### Scenario: A stepId from another pipeline is rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names a step belonging to a different pipeline
- **THEN** the response is an error naming the invalid reference
- **THEN** no step row is persisted
- **THEN** no rows from the foreign pipeline are read

#### Scenario: A stepId owned by another user is rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names a step in a pipeline owned by another user
- **THEN** the request is rejected and no step row is persisted
- **THEN** the referenced pipeline's existence is not disclosed beyond the existing pipeline-ACL semantics

#### Scenario: A nonexistent stepId is rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names a stepId that does not exist
- **THEN** the request is rejected with a named error and no step row is persisted

#### Scenario: A foreign or dangling reference is rejected at run time
- **WHEN** a pipeline whose stored steps contain a lane reference to a step outside that pipeline is run
- **THEN** the run fails with a named error identifying the invalid reference
- **THEN** no rows are read from any other pipeline

### Requirement: A lane-kind secondary input carries no data-source ACL check
For a `lane`-kind secondary input, given that same-pipeline membership has been validated per the preceding requirement, the pipeline's own ACL SHALL be the entire access gate and no data-source ownership check SHALL be applied. A `lane`-kind input SHALL NOT be evaluated by the source-kind ownership check under any circumstance.

#### Scenario: A lane-kind input is not subjected to a source ownership check
- **WHEN** a step is created with a `lane`-kind secondary input on a pipeline the caller owns
- **THEN** the step is created successfully
- **THEN** no data-source ownership lookup is performed for that step

#### Scenario: A source-kind input keeps its ownership check
- **WHEN** a step is created with `{"kind": "source", "dataSourceId": "<a source owned by another user>"}`
- **THEN** the response is `404 Not Found` and no step row is persisted

#### Scenario: An unset source-kind draft is still permitted
- **WHEN** a step is created with `{"kind": "source", "dataSourceId": ""}`, the picker's incomplete-draft default
- **THEN** the step is created with the second source left unset and no ownership check is triggered
- **THEN** decoding succeeds — an empty `dataSourceId` inside the discriminated shape is a legal incomplete draft, distinct from the legacy flat field, which is invalid
