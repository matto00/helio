## MODIFIED Requirements

### Requirement: Full rollback on any mid-apply failure
The service SHALL delete every resource this call created — the pipeline (and its steps/runs via
cascade), the pipeline's output DataType, and, if this call created it, the inline source and its
companion DataType — if any step after source/pipeline creation begins fails, including step creation
and the run itself, OR if the run completes execution but is blocked by an error-severity assertion
failure (see `pipeline-assert-fail-policy`) — a blocked run is treated identically to a run failure for
rollback purposes, since the proposal's output DataType was never actually populated either way.
Resource counts (sources, pipelines, pipeline steps, data types) SHALL be unchanged from immediately
before the call. This rollback rule does NOT apply when the run is never attempted because the resolved
source's kind is not supported by the execution engine at all (`PipelineRunService.SparkUnsupportedKinds`
— currently empty, since `rest_api` and `sql` are both execution-supported) — that case is not a run
failure; it is reported as a blocked run on a retained pipeline (see "Source-fetch failure creates a
needs-attention pipeline, not a rollback" above), regardless of whether schema inference succeeded. A
`rest_api` or `sql` source now reaches the ordinary `submit`/rollback path below like any other
supported source kind — a source-fetch failure at run time (as opposed to at create/schema-inference
time) is an ordinary run failure and rolls back exactly as any other execution failure would.

#### Scenario: A healthy rest_api or sql source reaches the ordinary run/rollback path
- **WHEN** a caller POSTs a proposal with an inline or existing-`sourceId` `rest_api` or `sql` source
  that is reachable, and steps that create successfully
- **THEN** the response is `201 Created` with the created pipeline and source, a `run` that is not
  `blocked`, and the output DataType is populated with the run's rows — the same outcome a `csv` or
  `static` source already produces, not the "execution-unsupported" blocked outcome

#### Scenario: A run failure on a rest_api or sql source rolls back the same as any other run failure
- **WHEN** a caller POSTs a proposal with an inline or existing-`sourceId` `rest_api` or `sql` source
  whose connector fetch fails at run time (e.g. the endpoint becomes unreachable between schema
  inference and the run), and steps that create successfully
- **THEN** the response is an error, and every resource this call created — the pipeline, its output
  DataType, and (if created by this call) the source and its companion DataType — is rolled back, the
  same as any other mid-apply run failure

#### Scenario: A run blocked by an error-severity assertion rolls back the same as a run failure
- **WHEN** a caller POSTs a proposal whose steps include an `assert` step, and the resulting run
  completes execution without exception but the assert step's error-severity rule fails
- **THEN** the response is an error carrying a message describing the assertion failure (not a success
  response with a `run` field pointing at an empty DataType), and counts of sources, pipelines, pipeline
  steps, and data types are all unchanged from before the call
