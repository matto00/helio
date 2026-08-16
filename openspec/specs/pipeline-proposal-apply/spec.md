# pipeline-proposal-apply Specification

## Purpose
Defines the atomic apply path that turns a reviewed `PipelineProposal` into a real source (if inline),
pipeline, ordered steps, and run — composing only existing services, with pre-validation guardrails and
full rollback on any mid-apply failure so a failed proposal leaves no partially-created resources.
## Requirements
### Requirement: Atomic apply of a PipelineProposal
`POST /api/pipelines/apply-proposal` SHALL accept a `PipelineProposal` and, composing only the
existing `SourceService`/`DataSourceService`, `PipelineService`, and `PipelineRunService`, atomically
create the resolved source (if the proposal's `source` is inline), the pipeline, its ordered steps,
and a run of that pipeline — returning the created source (if any), the pipeline summary, the output
DataType id, and the run result. No route or service in this requirement SHALL write to the database
directly; every write runs under the caller's RLS context via the composed services.

#### Scenario: A valid inline-static proposal creates and runs everything
- **WHEN** a caller POSTs a `PipelineProposal` whose `source` is an inline `static` spec, with one or
  more steps
- **THEN** the response is `201 Created` with the created source, the pipeline summary, the output
  DataType id, and a run result whose status reflects a completed run

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
create no source, pipeline, step, or DataType row.

#### Scenario: Non-SELECT SQL is rejected creating nothing
- **WHEN** a caller POSTs a proposal with an inline `sql` source whose query contains a DDL/DML keyword
- **THEN** the response is a `4xx` error, the SQL guardrail message is surfaced verbatim, and no source,
  pipeline, or DataType exists that did not exist before the call

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

### Requirement: Source-fetch failure is a structured, rolled-back error
The service SHALL delete the just-created source and return the connector's curated error message as a structured error response when the proposal's source is inline `rest_api` or `sql` and the connector cannot fetch/infer a schema — never an opaque `500` and never a partial success with a dangling source row.

#### Scenario: A REST fetch failure rolls back the created source
- **WHEN** a caller POSTs a proposal with an inline `rest_api` source whose endpoint is unreachable
- **THEN** the response is a structured error carrying the connector's message, and no data source
  exists afterward that did not exist before the call

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

### Requirement: Output DataType is pipeline-bindable
The output DataType created for the pipeline SHALL have `sourceId` unset (`null`), matching the
existing pipeline-output convention (V41) that makes a DataType eligible for panel binding.

#### Scenario: The output DataType has no sourceId
- **WHEN** a proposal is applied successfully
- **THEN** the returned output DataType's `sourceId` is absent/null

### Requirement: Non-mutating validation of a PipelineProposal
`PipelineProposalService` SHALL expose `validate(proposal, user): Future[Either[ServiceError,
Unit]]`, performing structural validation (mirroring the checks `apply` already runs before
resolving or creating anything) plus, for a source reference to an existing `sourceId`, a read-only
ownership/existence check — with no side effects and nothing created, regardless of whether the
result is `Left` or `Right`.

#### Scenario: A structurally valid proposal referencing an existing, owned source passes
- **WHEN** `validate` is called with a `PipelineProposal` whose source references an existing data
  source owned by the caller, and whose steps are structurally well-formed
- **THEN** the result is `Right(())`, and no pipeline, source, or run is created

#### Scenario: A structurally invalid proposal is rejected without creating anything
- **WHEN** `validate` is called with a `PipelineProposal` with a blank name, no steps, or a
  malformed step
- **THEN** the result is `Left(ServiceError.BadRequest(_))`, and no pipeline, source, or run is
  created

#### Scenario: A proposal referencing a nonexistent or unowned existing source is rejected
- **WHEN** `validate` is called with a `PipelineProposal` whose source references a `sourceId` that
  does not exist, or exists but is owned by a different user
- **THEN** the result is `Left(ServiceError.NotFound(_))`, and no pipeline, source, or run is
  created

