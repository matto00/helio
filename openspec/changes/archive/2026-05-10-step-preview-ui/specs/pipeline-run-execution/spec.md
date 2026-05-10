## ADDED Requirements

### Requirement: Partial pipeline execution stops at a specified step
The in-process execution engine SHALL support running only a subset of steps (positions 0 through K
inclusive). The existing `execute` method signature remains unchanged. Callers are responsible for
passing only the relevant slice of steps. The engine SHALL NOT be aware of "partial" vs "full"
execution — slicing happens in the route handler.

#### Scenario: Passing a subset of steps executes only those steps
- **WHEN** the engine's `execute` method is called with steps at positions [0, 1] out of a
  pipeline that has steps at positions [0, 1, 2]
- **THEN** only the first two steps are applied; step 2 is not applied
