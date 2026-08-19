## MODIFIED Requirements

### Requirement: Source-fetch failure is a structured, rolled-back error
The service SHALL NOT delete the just-created source when the proposal's source is inline `rest_api` or
`sql` and the connector cannot fetch/infer a schema. Apply SHALL proceed to create the pipeline against
that source, and the response's `run` SHALL be a `blocked` `RunResultResponse` whose `blockedReason`
carries the connector's curated error message — never an opaque `502` and never a silent full rollback.
This blocked state SHALL be persisted as a real run record (not only returned transiently in the apply
response), so it remains visible after a page reload — via the pipeline's `lastRunStatus` and its run
history — the same durable visibility a real failed run already gets.

#### Scenario: A REST fetch failure creates the source and pipeline, reporting a blocked run
- **WHEN** a caller POSTs a proposal with an inline `rest_api` source whose endpoint is unreachable
- **THEN** the response is `201 Created` with the created source, the pipeline summary, and a `run`
  whose `blocked` is `true` and whose `blockedReason` carries the connector's curated error message, and
  the pipeline's `lastRunStatus` and run history durably reflect the same failure afterward

### Requirement: Full rollback on any mid-apply failure
The service SHALL delete every resource this call created — the pipeline (and its steps/runs via
cascade), the pipeline's output DataType, and, if this call created it, the inline source and its
companion DataType — if any step after source/pipeline creation begins fails, including step creation
and the run itself, OR if the run completes execution but is blocked by an error-severity assertion
failure (see `pipeline-assert-fail-policy`) — a blocked run is treated identically to a run failure for
rollback purposes, since the proposal's output DataType was never actually populated either way.
Resource counts (sources, pipelines, pipeline steps, data types) SHALL be unchanged from immediately
before the call. This rollback rule does NOT apply when the run is never attempted because the resolved
source's kind is not supported by the execution engine (`rest_api`/`sql`) — that case is not a run
failure; it is reported as a blocked run on a retained pipeline (see "Source-fetch failure creates a
needs-attention pipeline, not a rollback" above), regardless of whether schema inference succeeded.

#### Scenario: An execution-unsupported source kind does not roll back
- **WHEN** a caller POSTs a proposal with an inline or existing-`sourceId` `rest_api` or `sql` source
  (schema fetch succeeds) and steps that create successfully
- **THEN** the response is `201 Created` with the created pipeline and source, a `run` whose `blocked`
  is `true` and whose `blockedReason` explains that this source kind isn't executed automatically yet,
  and a persisted run record exists so the pipeline's `lastRunStatus` durably reflects this — no
  resource is deleted

#### Scenario: A run blocked by an error-severity assertion rolls back the same as a run failure
- **WHEN** a caller POSTs a proposal whose steps include an `assert` step, and the resulting run
  completes execution without exception but the assert step's error-severity rule fails
- **THEN** the response is an error carrying a message describing the assertion failure (not a success
  response with a `run` field pointing at an empty DataType), and counts of sources, pipelines, pipeline
  steps, and data types are all unchanged from before the call
