# pipeline-lane-rejoin-input Specification

## Purpose
The discriminated secondary input for `join` / `union` / `lookup` — `{kind:"source", dataSourceId}` or `{kind:"lane", stepId}` — covering what a lane reference may name, multi-consumer (diamond) legality, same-pipeline membership as a security boundary, and cycle rejection at both write and run time.. Update Purpose after archive.

## Requirements

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
A `lane`-kind secondary input SHALL be permitted to name any node in the pipeline other than the referencing step itself, other than any of the referencing step's own ancestors, other than any of the referencing step's own descendants, and other than any node that already depends on the referencing step through a chain of parent and `lane` links. The named node is NOT REQUIRED to be the terminal node of its lane and is NOT REQUIRED to be materialized. Several rejoin steps MAY reference the same node.

#### Scenario: A mid-lane node may be referenced
- **WHEN** a rejoin step references a node that has a child of its own
- **THEN** the step is accepted at write time and the run consumes that node's post-evaluation frame

#### Scenario: A diamond is legal
- **WHEN** two separate rejoin steps each reference the same node
- **THEN** both are accepted at write time and both consume that node's frame in the same run
- **THEN** the referenced node is evaluated once

#### Scenario: A node upstream through another lane link is not a cycle
- **WHEN** a step's `lane`-kind secondary input names a node that the step itself depends on only through another step's `lane` link (not through its own parent chain)
- **THEN** the step is accepted at write time

### Requirement: A lane reference forming a cycle is rejected at write time and at run time
The backend SHALL reject a `lane`-kind secondary input that names the referencing step itself, any of its ancestors, any of its descendants, or any node that already depends on the referencing step through a chain of parent and `lane` links (a "dependent"; every descendant is a dependent). On `POST /api/pipelines/:id/steps` and on step update, the response SHALL be `400 Bad Request` and SHALL name the cycle; the step SHALL NOT be persisted. A descendant SHALL be reported as a descendant; a dependent that is not a descendant SHALL be reported as depending on the step through a lane link. For a create, the ancestors are those of the exact anchor the insert is placed at (including a bare `position` insert, anchored on the step at `position - 1`), and the dependents are the steps its insertion re-parents under it and every node that depends on those. A trunk reorder (`PUT /api/pipelines/:id/steps/order`) that would leave any step's stored `lane`-kind secondary input naming that step's own ancestor, descendant or dependent, where that violation did not exist before the reorder, SHALL be rejected with `400 Bad Request` naming the cycle, and no step's placement SHALL change. The engine SHALL additionally reject such a graph defensively at run time, so that a row reaching the table by any other path cannot produce a non-terminating or ill-defined walk.

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

#### Scenario: Reference to a step that depends on this step through a lane link rejected on update
- **WHEN** step `x` (not a descendant of `a`) has a `lane`-kind secondary input naming a descendant of step `a`, and `a`'s configuration is updated so its `lane`-kind secondary input names `x`
- **THEN** the response is `400 Bad Request` naming the cycle and stating that `x` depends on this step through a lane link
- **THEN** the stored configuration is unchanged

#### Scenario: Reference to a would-be descendant rejected on create
- **WHEN** a step is created at a placement that re-parents existing steps under it (including an append onto a trunk step that owns a tail) and its `lane`-kind secondary input names one of those steps
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: Reference to a would-be lane-linked dependent rejected on create
- **WHEN** a step is created at a placement that re-parents existing steps under it, and its `lane`-kind secondary input names a step that depends on one of those re-parented steps through a lane link
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: A bare-position create checks ancestors of its real anchor
- **WHEN** a step is created with only a `position` (no `parentStepId`, no `rootId`) on a single-root pipeline, at a placement whose anchor (the step at `position - 1` in execution order) re-parents nothing, and its `lane`-kind secondary input names a step that is neither that anchor, nor one of the anchor's ancestors, nor moved under the new step, even though it is an ancestor of the trunk's last step
- **THEN** the step is created

#### Scenario: A bare-position create referencing its anchor's chain is rejected
- **WHEN** a step is created with only a `position` and its `lane`-kind secondary input names the step at `position - 1` or one of its ancestors
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: A reorder that would make a lane reference cyclic is rejected
- **WHEN** a trunk reorder would leave a stored `lane`-kind secondary input naming one of the referencing step's own ancestors, descendants or lane-linked dependents
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** every step's parent, root and position are unchanged

#### Scenario: A reorder that introduces no lane cycle is unaffected
- **WHEN** a trunk reorder leaves every stored lane reference outside its referencing step's ancestors, descendants and dependents (or leaves unchanged a violation that already existed)
- **THEN** the reorder succeeds as before

#### Scenario: A cyclic graph is rejected at run time
- **WHEN** a pipeline whose stored steps contain a lane-reference cycle is run
- **THEN** the run fails with a named error identifying the cycle
- **THEN** no step in the cycle is evaluated

### Requirement: A lane reference must name a step in the same pipeline
A `lane`-kind secondary input SHALL name a step belonging to the same pipeline. A `stepId` that does not exist, or that belongs to a different pipeline — including a pipeline owned by another user — SHALL be rejected at write time with a named error, and SHALL be rejected defensively at run time. This validation is a security boundary: it is the sole justification for applying no data-source ownership check on the lane branch, and cycle detection cannot substitute for it because a dangling or foreign id forms no cycle. The caller's edit access to the target pipeline SHALL be established before any lane reference is checked, so that a caller without edit access receives the same response whether or not the referenced step exists.

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

#### Scenario: Creating on a pipeline the caller cannot edit discloses nothing about the referenced step
- **WHEN** a caller with no access (or viewer-only access) to a pipeline creates a step on it whose `lane`-kind secondary input names, in one request, an existing step of that pipeline and, in another, a stepId that does not exist
- **THEN** both responses carry the same status and body (the pipeline-access error)
- **THEN** no step row is persisted

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
