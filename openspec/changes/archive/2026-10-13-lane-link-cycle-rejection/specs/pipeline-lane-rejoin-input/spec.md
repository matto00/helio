## MODIFIED Requirements

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
