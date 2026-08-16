## MODIFIED Requirements

### Requirement: Full rollback on any mid-apply failure
The service SHALL delete every resource this call created — the pipeline (and its steps/runs via
cascade), the pipeline's output DataType, and, if this call created it, the inline source and its
companion DataType — if any step after source/pipeline creation begins fails, including step creation
and the run itself, OR if the run completes execution but is blocked by an error-severity assertion
failure (see `pipeline-assert-fail-policy`) — a blocked run is treated identically to a run failure for
rollback purposes, since the proposal's output DataType was never actually populated either way.
Resource counts (sources, pipelines, pipeline steps, data types) SHALL be unchanged from immediately
before the call.

#### Scenario: A run failure rolls back the pipeline, its output type, and an inline source
- **WHEN** a caller POSTs a proposal with an inline `rest_api` or `sql` source (schema fetch succeeds)
  and the subsequent run fails because that source kind is unsupported for execution
- **THEN** the response is an error carrying the run failure's message, and counts of sources,
  pipelines, pipeline steps, and data types are all unchanged from before the call

#### Scenario: A run blocked by an error-severity assertion rolls back the same as a run failure
- **WHEN** a caller POSTs a proposal whose steps include an `assert` step, and the resulting run
  completes execution without exception but the assert step's error-severity rule fails
- **THEN** the response is an error carrying a message describing the assertion failure (not a success
  response with a `run` field pointing at an empty DataType), and counts of sources, pipelines, pipeline
  steps, and data types are all unchanged from before the call
