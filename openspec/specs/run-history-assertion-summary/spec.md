# run-history-assertion-summary Specification

## Purpose
Make 419-B's per-run assertion results visible in Run History, so a user can see at a glance which runs
passed, warned, or failed their assertions, and why.
## Requirements
### Requirement: Run history includes a pass/fail-by-severity assertion summary per run
The system SHALL include an `assertions` summary on every `PipelineRunRecord` returned by
`GET /api/pipelines/:id/run-history`, containing counts of passed assertions, warn-severity failures,
and error-severity failures, plus the details (kind, field, severity, message) of every failing rule. A
run with no `assert` steps SHALL report zero counts and an empty failure list, not an absent field.

#### Scenario: A run with passing and failing assertions reports accurate counts
- **WHEN** a run evaluates three rules — two pass, one `error`-severity rule fails
- **THEN** its `PipelineRunRecord.assertions` reports `passed: 2`, `errorFailed: 1`, `warnFailed: 0`,
  and `failures` contains exactly the one failing rule's detail

#### Scenario: A run with no assert steps reports a zero-valued summary
- **WHEN** a run's pipeline has no `assert` steps
- **THEN** its `PipelineRunRecord.assertions` reports `passed: 0`, `warnFailed: 0`, `errorFailed: 0`,
  and an empty `failures` list

### Requirement: Run History UI shows the assertion summary with failing rules expandable
`RunHistoryModal.tsx` SHALL display each run's pass/fail-by-severity assertion summary, and its existing
per-row expand toggle SHALL also reveal the failing rules' messages when `assertions.failures` is
non-empty, in addition to the existing execution-failure `errorLog` display.

#### Scenario: Expanding a run with failing assertions shows the failure messages
- **WHEN** a user expands a run row whose `assertions.failures` is non-empty
- **THEN** each failing rule's kind, field, and message are displayed

