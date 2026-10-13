## MODIFIED Requirements

### Requirement: A lane reference forming a cycle is rejected at write time and at run time
The backend SHALL reject a `lane`-kind secondary input that names the referencing step itself, any of its ancestors, or any of its descendants. On `POST /api/pipelines/:id/steps` and on step update, the response SHALL be `400 Bad Request` and SHALL name the cycle; the step SHALL NOT be persisted. For a create, the ancestors are those of the exact anchor the insert is placed at (including a bare `position` insert, anchored on the step at `position - 1`), and the descendants are the steps its insertion re-parents under it, and everything below those. A trunk reorder (`PUT /api/pipelines/:id/steps/order`) that would leave any step's stored `lane`-kind secondary input naming that step's own ancestor or descendant, where that violation did not exist before the reorder, SHALL be rejected with `400 Bad Request` naming the cycle, and no step's placement SHALL change. The engine SHALL additionally reject such a graph defensively at run time, so that a row reaching the table by any other path cannot produce a non-terminating or ill-defined walk.

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

#### Scenario: A bare-position create checks ancestors of its real anchor
- **WHEN** a step is created with only a `position` (no `parentStepId`, no `rootId`) on a single-root pipeline, at a placement whose anchor (the step at `position - 1` in execution order) re-parents nothing, and its `lane`-kind secondary input names a step that is neither that anchor, nor one of the anchor's ancestors, nor moved under the new step, even though it is an ancestor of the trunk's last step
- **THEN** the step is created

#### Scenario: A bare-position create referencing its anchor's chain is rejected
- **WHEN** a step is created with only a `position` and its `lane`-kind secondary input names the step at `position - 1` or one of its ancestors
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** no step row is persisted

#### Scenario: A reorder that would make a lane reference cyclic is rejected
- **WHEN** a trunk reorder would place a step that a stored `lane`-kind secondary input names among the referencing step's own ancestors or descendants
- **THEN** the response is `400 Bad Request` naming the cycle
- **THEN** every step's parent, root and position are unchanged

#### Scenario: A reorder that introduces no lane cycle is unaffected
- **WHEN** a trunk reorder leaves every stored lane reference outside its referencing step's ancestors and descendants (or leaves unchanged a violation that already existed)
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
