## MODIFIED Requirements

### Requirement: POST /api/pipelines/:id/steps appends a step against a parent or a root
Appending a step SHALL require exactly one of `parentStepId` or `rootId`. Supplying neither, both, or a `rootId` naming a root of another pipeline SHALL fail with a named error. The database SHALL enforce that a step has a root id if and only if it has no parent step, so a step cannot be persisted in a state the walk would silently skip.

A step created with `rootId` and no `parentStepId` SHALL be placed on THAT root's trunk (the chain from the root's lowest-`position` root-level step through each step's first `position`-0 child), and SHALL NOT be placed on any other root's trunk:
- With no `position`, the step SHALL be appended as the trunk continuation of that root's trunk-last step. When the root has no trunk steps, the step SHALL become the root's first step.
- With `position` k, `position` SHALL be read as an index into that root's trunk, not into the whole pipeline: k = 0 places the step before the root's first trunk step, and 0 < k <= trunk length places it directly after the root's k-th trunk step (k = trunk length is the same placement as no `position`). The step SHALL be spliced in at that slot: the step that occupied the slot SHALL become its child, and ALL of the anchor's existing children (tail lanes included) SHALL move under the new step.
- A `position` outside `0 <= position <= trunk length` SHALL fail with `422` and nothing SHALL be persisted.
- Steps of every other root SHALL be unchanged by the create.
- With `rejectIfReparents: true`, the create SHALL be refused (422, nothing written) exactly when this placement would re-parent an existing step: a no-`position` append whose trunk-last step already has children, a `position` equal to the trunk length onto a trunk-last step that has children (tail lanes), or an insert whose slot is occupied.

#### Scenario: Appending a root-level step names its root
- **WHEN** a step is appended with `rootId` naming a root of that pipeline and no `parentStepId`
- **THEN** the step is created with that root id and appears in that root's lane

#### Scenario: Appending with neither parent nor root is rejected
- **WHEN** a step is appended with neither `parentStepId` nor `rootId`
- **THEN** the request fails with a named error and no step is created

#### Scenario: Appending with a root of another pipeline is rejected
- **WHEN** a step is appended with a `rootId` belonging to a different pipeline
- **THEN** the request fails with a named error and no step is created

#### Scenario: A parentless step with no root cannot be persisted
- **WHEN** a write would persist a step with both a null parent step id and a null root id
- **THEN** the database rejects it

#### Scenario: A rootId create with no position appends at that root's trunk tail
- **WHEN** a root's trunk is A, B, C and a step is created with that `rootId` and no `position`
- **THEN** the resulting trunk is A, B, C, NEW, and no existing step is reparented

#### Scenario: A rootId create with a position inserts at that trunk slot
- **WHEN** a root's trunk is A, B, C and a step is created with that `rootId` and `position` 2
- **THEN** the resulting trunk is A, B, NEW, C, and only C is reported as reparented

#### Scenario: A rootId create at position 0 becomes the root's first step
- **WHEN** a root's trunk is A, B, C and a step is created with that `rootId` and `position` 0
- **THEN** the resulting trunk is NEW, A, B, C, and only A is reported as reparented

#### Scenario: A rootId create into an empty root becomes its first step
- **WHEN** a root has no steps and a step is created with that `rootId`, with no `position` or with `position` 0
- **THEN** the step is that root's only step and no step is reparented

#### Scenario: A rootId create with an out-of-range position is rejected
- **WHEN** a root's trunk has 3 steps and a step is created with that `rootId` and `position` 4 (or -1)
- **THEN** the response is `422` and no step is created

#### Scenario: A rootId create on a multi-root pipeline touches only that root
- **WHEN** a pipeline has root R1 with trunk A, B and root R2 with trunk X, Y, and a step is created with `rootId` R2, once with no `position` and once with `position` 1
- **THEN** R2's trunk becomes X, Y, NEW after the first create and X, NEW2, Y, NEW after the second
- **THEN** R1's trunk is still A, B with every R1 step's parent and root unchanged

#### Scenario: A rootId append onto a root whose only root-level step is not position 0
- **WHEN** a root's only root-level step T has `position` 1 and a step is created with that `rootId` and no `position`
- **THEN** the step is created as T's child and T is not reparented

#### Scenario: The reparent guard follows the rootId placement
- **WHEN** a root's trunk is A, B, B has no children, and a step is created with that `rootId`, no `position` and `rejectIfReparents: true`
- **THEN** the step is created as B's child and nothing is reparented
- **WHEN** the same request is made with `position` 0
- **THEN** the response is `422` naming A, and nothing is written
