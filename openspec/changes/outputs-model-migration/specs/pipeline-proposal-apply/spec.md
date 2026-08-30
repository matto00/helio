## MODIFIED Requirements

_Retargeted from DataTypes/Metrics to the outputs-model (Output, node_snapshot, pipeline-step-tree) per HEL-903 decisions 1/2/4/11. Scenario titles are preserved verbatim from the live spec even where they still name "DataType"/"Metric" (they describe the same test case); only the body text is retargeted to the new mechanism._

### Requirement: Atomic apply of a PipelineProposal
`POST /api/pipelines/apply-proposal` SHALL accept a `PipelineProposal` and, composing only the
existing `SourceService`/`DataSourceService`, `PipelineService`, and `PipelineRunService`, atomically
create the resolved source (if the proposal's `source` is inline), the pipeline, its ordered steps,
and a run of that pipeline — returning the created source (if any), the pipeline summary, the output
Output/node id, and the run result. No route or service in this requirement SHALL write to the database
directly; every write runs under the caller's RLS context via the composed services.

#### Scenario: A valid inline-static proposal creates and runs everything
- **WHEN** a caller POSTs a `PipelineProposal` whose `source` is an inline `static` spec, with one or
  more steps
- **THEN** the response is `201 Created` with the created source, the pipeline summary, the output
  Output/node id, and a run result whose status reflects a completed run

#### Scenario: A valid existing-sourceId proposal creates and runs everything
- **WHEN** a caller POSTs a `PipelineProposal` whose `source` supplies only `sourceId` for a source the
  caller owns
- **THEN** the response is `201 Created`, the response's `source` field is absent, and the pipeline is
  created against that existing source

### Requirement: Structural pre-validation creates nothing on a bad proposal
Before any resource is created, the service SHALL reject: a `source` that sets both `sourceId` and an
inline `type`; a `source` that sets neither; an inline `type` outside `csv`/`rest_api`/`sql`/`static`;
an inline source whose `name` is absent or blank; an inline source whose type-matched `config` field is
absent; an inline `sql` source whose query is not read-only; and any step whose `type` is not a
recognized pipeline step kind or whose `config` does not decode for that kind. Every rejection SHALL
create no source, pipeline, step, or Output/node row.

#### Scenario: Non-SELECT SQL is rejected creating nothing
- **WHEN** a caller POSTs a proposal with an inline `sql` source whose query contains a DDL/DML keyword
- **THEN** the response is a `4xx` error, the SQL guardrail message is surfaced verbatim, and no source,
  pipeline, or Output/node exists that did not exist before the call

#### Scenario: Both sourceId and inline type set is rejected
- **WHEN** a caller POSTs a proposal whose `source` sets both `sourceId` and `type`
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: Inline csv is rejected with a clear error, not a 500
- **WHEN** a caller POSTs a proposal with an inline `csv` source
- **THEN** the response is a structured `4xx` error stating inline CSV is not yet supported, and
  nothing is created

#### Scenario: Inline source missing a name is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose `source` sets an inline `type` (e.g. `sql` or `rest_api`) but
  omits `name`
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: Inline source missing its type-matched config is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose `source` sets an inline `type` of `sql` or `rest_api` but
  omits the matching `config` object
- **THEN** the response is a `400 Bad Request` and nothing is created — no unhandled server error and no
  source row is created

### Requirement: Full rollback on any mid-apply failure
The service SHALL delete every resource this call created — the pipeline (and its steps/runs via
cascade), the pipeline node's Output, and, if this call created it, the inline source and its
companion Output/node — if any step after source/pipeline creation begins fails, including step creation
and the run itself, OR if the run completes execution but is blocked by an error-severity assertion
failure (see `pipeline-assert-fail-policy`) — a blocked run is treated identically to a run failure for
rollback purposes, since the proposal's Output was never actually populated either way.
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
  `blocked`, and the Output is populated with the run's rows — the same outcome a `csv` or
  `static` source already produces, not the "execution-unsupported" blocked outcome

#### Scenario: A run failure on a rest_api or sql source rolls back the same as any other run failure
- **WHEN** a caller POSTs a proposal with an inline or existing-`sourceId` `rest_api` or `sql` source
  whose connector fetch fails at run time (e.g. the endpoint becomes unreachable between schema
  inference and the run), and steps that create successfully
- **THEN** the response is an error, and every resource this call created — the pipeline, its output
  Output/node, and (if created by this call) the source and its companion Output/node — is rolled back, the
  same as any other mid-apply run failure

#### Scenario: A run blocked by an error-severity assertion rolls back the same as a run failure
- **WHEN** a caller POSTs a proposal whose steps include an `assert` step, and the resulting run
  completes execution without exception but the assert step's error-severity rule fails
- **THEN** the response is an error carrying a message describing the assertion failure (not a success
  response with a `run` field pointing at an empty Output/node), and counts of sources, pipelines, pipeline
  steps, and data types are all unchanged from before the call

### Requirement: Output DataType is pipeline-bindable
The Output created for the pipeline SHALL have `sourceId` unset (`null`), matching the
existing pipeline-output convention (V41) that makes an Output/node eligible for panel binding.

#### Scenario: The output DataType has no sourceId
- **WHEN** a proposal is applied successfully
- **THEN** the returned Output's `sourceId` is absent/null
