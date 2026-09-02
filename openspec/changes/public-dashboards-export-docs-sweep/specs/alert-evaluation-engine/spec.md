## MODIFIED Requirements

### Requirement: Breach drives a firing event
When a rule breaches, the system SHALL call `AlertEventRepository.upsertFiringInternal` with the
rule's `id`, `ownerId`, `targetOutputId`, the extracted value (as a `JsNumber`), the
`triggeringRunId`, and the rule's `severity`.

#### Scenario: First breach creates a firing event
- **WHEN** a rule breaches and has no existing active `AlertEvent`
- **THEN** exactly one new `AlertEvent` is created in state `firing`

#### Scenario: Repeated breach refreshes the existing event, no duplicate
- **WHEN** a rule breaches on two consecutive evaluations without an intervening resolve
- **THEN** exactly one active `AlertEvent` exists for that rule after both evaluations (the
  HEL-455 dedup contract), with `lastEvaluatedAt` refreshed

### Requirement: Evaluation never fails the triggering pipeline run
The system SHALL produce no evaluation and no `AlertEvent` changes for a run that fails before reaching
the row-write step, or that reaches `onRunSuccess` but is blocked by the assert fail-policy before the
row-write step (see `pipeline-assert-fail-policy`) — evaluating rules against rows that were never
actually written to the DataType would fire alerts referencing values no dashboard ever displays. Once invoked, an
exception raised while evaluating one rule, or while evaluating rules for a `OutputId` overall, SHALL
be logged and SHALL NOT propagate to the caller in a way that fails or rolls back the triggering
pipeline run.

#### Scenario: A failed pipeline run creates no events
- **WHEN** a pipeline run fails before `onRunSuccess` is reached
- **THEN** `evaluateForDataType` is never invoked and no `AlertEvent` is created

#### Scenario: One rule's evaluation error does not block sibling rules
- **WHEN** evaluating two enabled rules for the same `OutputId`, and the first rule's
  `condition` is malformed (missing `comparator`/`threshold`) causing an exception
- **THEN** the first rule's failure is logged and the second rule is still evaluated normally

#### Scenario: Evaluation failure does not fail the pipeline run
- **WHEN** `evaluateForDataType` raises an exception (e.g. an unexpected repository failure)
- **THEN** `PipelineRunService.onRunSuccess`'s returned `Future` still succeeds and the pipeline
  run is recorded as `succeeded`

#### Scenario: A run blocked by the assert fail-policy creates no events
- **WHEN** `onRunSuccess` is reached but the run is blocked by an error-severity assertion failure
  before the row-write step
- **THEN** `evaluateForDataType` is never invoked and no `AlertEvent` is created, even though
  `onRunSuccess` itself was reached (unlike an execution failure, which never reaches it)

