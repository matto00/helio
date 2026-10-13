## MODIFIED Requirements

### Requirement: A lane reference may name any non-ancestor node, and a node may be referenced more than once
A `lane`-kind secondary input SHALL be permitted to name any node in the pipeline other than the referencing step itself, other than any of the referencing step's own ancestors, and other than any of the referencing step's own descendants. The named node is NOT REQUIRED to be the terminal node of its lane and is NOT REQUIRED to be materialized. Several rejoin steps MAY reference the same node.

#### Scenario: A mid-lane node may be referenced
- **WHEN** a rejoin step references a node that has a child of its own
- **THEN** the step is accepted at write time and the run consumes that node's post-evaluation frame

#### Scenario: A diamond is legal
- **WHEN** two separate rejoin steps each reference the same node
- **THEN** both are accepted at write time and both consume that node's frame in the same run
- **THEN** the referenced node is evaluated once

### Requirement: A lane reference forming a cycle is rejected at write time and at run time
The backend SHALL reject a `lane`-kind secondary input that names the referencing step itself, any of its ancestors, or any of its descendants. On `POST /api/pipelines/:id/steps` and on step update, the response SHALL be `400 Bad Request` and SHALL name the cycle; the step SHALL NOT be persisted. For a create, the descendants are the steps its insertion re-parents under it, and everything below those. The engine SHALL additionally reject such a graph defensively at run time, so that a row reaching the table by any other path cannot produce a non-terminating or ill-defined walk.

#### Scenario: Self-reference rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names that same step
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: Ancestor reference rejected at write time
- **WHEN** a step is created whose `lane`-kind secondary input names one of its own ancestors
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: Descendant reference rejected on update
- **WHEN** a step's configuration is updated so its `lane`-kind secondary input names one of its own descendants
- **THEN** the response is `400 Bad Request` naming the cycle and identifying that the named step is a descendant of this step
- **THEN** the stored configuration is unchanged

#### Scenario: Reference to a would-be descendant rejected on create
- **WHEN** a step is created at a placement that re-parents existing steps under it (including an append onto a trunk step that owns a tail) and its `lane`-kind secondary input names one of those steps
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: A cyclic graph is rejected at run time
- **WHEN** a pipeline whose stored steps contain a lane-reference cycle is run
- **THEN** the run fails with a named error identifying the cycle
- **THEN** no step in the cycle is evaluated
