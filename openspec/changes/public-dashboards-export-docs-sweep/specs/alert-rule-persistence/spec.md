## MODIFIED Requirements

### Requirement: Privileged internal read for the evaluation engine
`AlertRuleRepository` SHALL expose `listEnabledByDataTypeInternal(outputId: OutputId)` running
through `withSystemContext` (RLS bypass), returning all enabled rules targeting the given
DataType regardless of owner, for use by a background/system-context caller with no request user.

#### Scenario: Returns enabled rules across owners
- **WHEN** `listEnabledByDataTypeInternal(outputId)` is called and enabled rules targeting that
  DataType exist for multiple different owners
- **THEN** all of them are returned, bypassing per-owner RLS restriction

#### Scenario: Excludes disabled rules
- **WHEN** a rule targeting the DataType exists but `enabled = false`
- **THEN** it is excluded from the result
