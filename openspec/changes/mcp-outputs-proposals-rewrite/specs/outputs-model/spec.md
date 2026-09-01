## MODIFIED Requirements

### Requirement: An Output inherits its pipeline's tag for teardown purposes
For `teardown_resources`/tag-cascade purposes, an Output SHALL be treated as inheriting its
owning pipeline's tag, with no independent tag of its own required for cascade deletion to reach
it.

#### Scenario: An Output with no tag of its own is still removed by its pipeline's tag teardown
- **WHEN** a pipeline tagged `demo` with an Output that has no explicit tag is torn down via
  `teardown_resources(tag="demo")`
- **THEN** the Output (and its placements) is removed as part of that teardown
