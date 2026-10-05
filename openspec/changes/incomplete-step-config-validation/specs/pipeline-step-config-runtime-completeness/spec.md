## ADDED Requirements

### Requirement: Step-configuration failures are logged as user errors, not server faults
When pipeline execution on any surface (step preview, Output preview, dry run, real run, Output backfill) fails
because of a step-configuration problem — a step kind's required-configuration check, or an invalid configuration
value detected by a step while evaluating — the server SHALL log a single WARN-level line naming
the pipeline, the step id, the step kind and the reason, and SHALL NOT log it at ERROR or attach a stack trace. Any
other execution failure SHALL continue to be logged at ERROR with its stack trace. Run failure messages persisted
to run history and published on the run event stream SHALL be unchanged.

#### Scenario: Previewing an incomplete step logs no ERROR
- **WHEN** a step whose required configuration is empty is previewed
- **THEN** no ERROR-level log event is emitted for the failure
- **AND** exactly one WARN-level event names the step id, kind and reason, with no throwable attached

#### Scenario: Running an incomplete step logs no ERROR
- **WHEN** a pipeline containing that step is run, dry or real
- **THEN** the run fails with the same message as before and no ERROR-level log event with a stack trace is emitted
  for the step-configuration failure

#### Scenario: Data, reference and provider failures still log at ERROR
- **WHEN** a step fails because of its input data, an unresolved lane or source reference, or an external model
  provider error
- **THEN** the failure is logged at ERROR with its stack trace, as before
