# pipeline-proposal-apply Specification

## Purpose
Defines the atomic apply path that turns a reviewed `PipelineProposal` into a real source (if inline),
pipeline, ordered steps, and run — composing only existing services, with pre-validation guardrails and
full rollback on any mid-apply failure so a failed proposal leaves no partially-created resources.

## Requirements

### Requirement: Atomic apply of a PipelineProposal
`POST /api/pipelines/apply-proposal` SHALL accept a `PipelineProposal` and, composing only the
existing `SourceService`/`DataSourceService`, `PipelineService`, and `PipelineRunService`, atomically
create the resolved sources (for every inline root), the pipeline and all of its roots, its steps,
and a run of that pipeline — returning the created sources (if any), the pipeline summary, the output
Output id, and the run result. No route or service in this requirement SHALL write to the database
directly; every write runs under the caller's RLS context via the composed services.

Every element of `roots` SHALL be resolved and created **before any step is created**, and each
parentless step SHALL be bound to the root its `rootClientId` names. Failure to resolve any root
SHALL roll back the whole apply, creating nothing — no source, pipeline, root, step, or Output.
No root SHALL be treated as primary and no step SHALL silently default to the first root: a
parentless step with no `rootClientId`, on a proposal carrying more than one root, is a named
rejection, not a default.

#### Scenario: A valid inline-static proposal creates and runs everything
- **WHEN** a caller POSTs a `PipelineProposal` whose single root is an inline `static` spec, with one
  or more steps
- **THEN** the response is `201 Created` with the created source, the pipeline summary, the output
  Output id, and a run result whose status reflects a completed run

#### Scenario: A valid existing-sourceId proposal creates and runs everything
- **WHEN** a caller POSTs a `PipelineProposal` whose single root supplies only `sourceId` for a source
  the caller owns
- **THEN** the response is `201 Created`, no source is reported as created, and the pipeline is
  created against that existing source

#### Scenario: A two-root proposal applies atomically
- **WHEN** a proposal with two roots and a lane under each is applied
- **THEN** the created pipeline has two roots in document order and each lane's parentless step is
  bound to the root its `rootClientId` named

#### Scenario: An unresolvable second root rolls back the whole apply
- **WHEN** a proposal's second root names a source the caller cannot read
- **THEN** the apply fails with a not-found error and no pipeline, root, source, step, or Output is
  created — including the first root's source, which resolved successfully

#### Scenario: A parentless step naming no root on a multi-root proposal is rejected
- **WHEN** a proposal carries two roots and a parentless step with no `rootClientId`
- **THEN** the apply fails with a named error, nothing is created, and the step is not defaulted onto
  the first root

### Requirement: Structural pre-validation creates nothing on a bad proposal
Before any resource is created, the service SHALL validate **every element of `roots`
independently**, rejecting: a root that sets both `sourceId` and an inline `type`; a root that sets
neither; an inline `type` outside `csv`/`rest_api`/`sql`/`static`; an inline root whose `name` is
absent or blank; an inline root whose type-matched `config` field is absent; an inline `sql` root
whose query is not read-only; an empty `roots` array; and any step whose `type` is not a recognized
pipeline step kind or whose `config` does not decode for that kind. A rejection SHALL name the
offending root by its request position, so a fault in the second root is not reported against the
first. Every rejection SHALL create no source, pipeline, root, step, or Output row.

#### Scenario: Non-SELECT SQL is rejected creating nothing
- **WHEN** a caller POSTs a proposal with an inline `sql` root whose query contains a DDL/DML keyword
- **THEN** the response is a `4xx` error, the SQL guardrail message is surfaced verbatim, and no source,
  pipeline, or Output exists that did not exist before the call

#### Scenario: Both sourceId and inline type set is rejected
- **WHEN** a caller POSTs a proposal whose root sets both `sourceId` and `type`
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: Inline csv is rejected with a clear error, not a 500
- **WHEN** a caller POSTs a proposal with an inline `csv` root
- **THEN** the response is a structured `4xx` error stating inline CSV is not yet supported, and
  nothing is created

#### Scenario: Inline source missing a name is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose root sets an inline `type` (e.g. `sql` or `rest_api`) but
  omits `name`
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: Inline source missing its type-matched config is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose root sets an inline `type` of `sql` or `rest_api` but
  omits the matching `config` object
- **THEN** the response is a `400 Bad Request` and nothing is created — no unhandled server error and no
  source row is created

#### Scenario: An empty roots array is rejected creating nothing
- **WHEN** a caller POSTs a proposal whose `roots` array is empty
- **THEN** the response is a `400 Bad Request` and nothing is created

#### Scenario: A fault in the second root is reported against that root
- **WHEN** a caller POSTs a proposal whose first root is valid and whose second root sets neither
  `sourceId` nor `type`
- **THEN** the response is a `400 Bad Request` naming the second root's request position, and nothing
  is created

### Requirement: Source-fetch failure is a structured, rolled-back error
The service SHALL NOT delete a just-created source when **a root's** inline `rest_api` or `sql`
source cannot fetch/infer a schema. Apply SHALL proceed to create the pipeline against that source,
and the response's `run` SHALL be a `blocked` `RunResultResponse` whose `blockedReason` carries the
connector's curated error message, naming which root failed — never an opaque `502` and never a
silent full rollback. When more than one root fails this way, every failing root SHALL be named
rather than only the first. This blocked state SHALL be persisted as a real run record (not only
returned transiently in the apply response), so it remains visible after a page reload — via the
pipeline's `lastRunStatus` and its run history — the same durable visibility a real failed run
already gets.

This is distinct from a root that cannot be **resolved** (an unreadable or non-existent `sourceId`),
which rolls the whole apply back per "Atomic apply of a PipelineProposal" above. Failing to resolve a
root is a rollback; failing to fetch from a resolved root is a blocked run.

#### Scenario: A REST fetch failure creates the source and pipeline, reporting a blocked run
- **WHEN** a caller POSTs a proposal with an inline `rest_api` root whose endpoint is unreachable
- **THEN** the response is `201 Created` with the created source, the pipeline summary, and a `run`
  whose `blocked` is `true` and whose `blockedReason` carries the connector's curated error message, and
  the pipeline's `lastRunStatus` and run history durably reflect the same failure afterward

#### Scenario: A fetch failure on the second of two roots names that root
- **WHEN** a caller POSTs a two-root proposal whose second root's inline `rest_api` endpoint is
  unreachable and whose first root fetches successfully
- **THEN** the response is `201 Created`, both roots exist, and the blocked run's `blockedReason`
  names the second root

### Requirement: Full rollback on any mid-apply failure
The service SHALL delete every resource this call created — the pipeline (and its roots/steps/runs
via cascade), the pipeline node's Output, and **every inline source this call created, across every
root, together with those sources' companion Outputs** — if any step after source/pipeline creation
begins fails, including step creation and the run itself, OR if the run completes execution but is
blocked by an error-severity assertion failure (see `pipeline-assert-fail-policy`) — a blocked run is
treated identically to a run failure for rollback purposes, since the proposal's Output was never
actually populated either way. Rolling back only the first root's source would leave orphaned
sources behind on every multi-root failure.

**The two rollback paths SHALL share one cleanup list.** Resolve-time rollback (a root that cannot be
resolved, per "Atomic apply of a PipelineProposal") and late-failure rollback (this requirement) are
different triggers, not different cleanup rules: both delete exactly the set of resources this call
created, accumulated as the apply proceeds. They SHALL NOT maintain separate notions of what to clean
up, because a divergence between them is invisible until it orphans a resource.

Resource counts (sources, pipelines, pipeline roots, pipeline steps, data types) SHALL be unchanged
from immediately before the call. This rollback rule does NOT apply when the run is never attempted
because a resolved source's kind is not supported by the execution engine at all
(`PipelineRunService.SparkUnsupportedKinds` — currently empty, since `rest_api` and `sql` are both
execution-supported) — that case is not a run failure; it is reported as a blocked run on a retained
pipeline (see "Source-fetch failure is a structured, rolled-back error" above), regardless of whether
schema inference succeeded. A `rest_api` or `sql` source now reaches the ordinary `submit`/rollback
path below like any other supported source kind — a source-fetch failure at run time (as opposed to
at create/schema-inference time) is an ordinary run failure and rolls back exactly as any other
execution failure would.

#### Scenario: A healthy rest_api or sql source reaches the ordinary run/rollback path
- **WHEN** a caller POSTs a proposal with an inline or existing-`sourceId` `rest_api` or `sql` root
  that is reachable, and steps that create successfully
- **THEN** the response is `201 Created` with the created pipeline and source, a `run` that is not
  `blocked`, and the Output is populated with the run's rows — the same outcome a `csv` or
  `static` source already produces, not the "execution-unsupported" blocked outcome

#### Scenario: A run failure on a rest_api or sql source rolls back the same as any other run failure
- **WHEN** a caller POSTs a proposal with an inline or existing-`sourceId` `rest_api` or `sql` root
  whose connector fetch fails at run time (e.g. the endpoint becomes unreachable between schema
  inference and the run), and steps that create successfully
- **THEN** the response is an error, and every resource this call created — the pipeline, its output
  Output, and (if created by this call) the source and its companion Output — is rolled back, the
  same as any other mid-apply run failure

#### Scenario: A late failure on a two-root proposal rolls back both roots' created sources
- **WHEN** a caller POSTs a proposal with two inline roots, both of which resolve and create their
  sources successfully, and the run then fails
- **THEN** both created sources and both companion Outputs are deleted, along with the pipeline, its
  roots, its steps, and its Outputs — the second root's source is not left orphaned

#### Scenario: A run blocked by an error-severity assertion rolls back the same as a run failure
- **WHEN** a caller POSTs a proposal whose steps include an `assert` step, and the resulting run
  completes execution without exception but the assert step's error-severity rule fails
- **THEN** the response is an error carrying a message describing the assertion failure (not a success
  response with a `run` field pointing at an empty Output), and counts of sources, pipelines, pipeline
  roots, pipeline steps, and data types are all unchanged from before the call

### Requirement: Output DataType is pipeline-bindable
The Output created for the pipeline SHALL have `sourceId` unset (`null`), matching the
existing pipeline-output convention (V41) that makes an Output eligible for panel binding.

#### Scenario: The output DataType has no sourceId
- **WHEN** a proposal is applied successfully
- **THEN** the returned Output's `sourceId` is absent/null

### Requirement: Non-mutating validation of a PipelineProposal
`PipelineProposalService` SHALL expose `validate(proposal, user): Future[Either[ServiceError,
Unit]]`, performing structural validation (mirroring the checks `apply` already runs before
resolving or creating anything) plus, for **each** root referencing an existing `sourceId`, a
read-only ownership/existence check — with no side effects and nothing created, regardless of
whether the result is `Left` or `Right`.

#### Scenario: A structurally valid proposal referencing an existing, owned source passes
- **WHEN** `validate` is called with a `PipelineProposal` whose roots each reference an existing data
  source owned by the caller, and whose steps are structurally well-formed
- **THEN** the result is `Right(())`, and no pipeline, source, or run is created

#### Scenario: A structurally invalid proposal is rejected without creating anything
- **WHEN** `validate` is called with a `PipelineProposal` with a blank name, no steps, or a
  malformed step
- **THEN** the result is `Left(ServiceError.BadRequest(_))`, and no pipeline, source, or run is
  created

#### Scenario: A proposal referencing a nonexistent or unowned existing source is rejected
- **WHEN** `validate` is called with a `PipelineProposal` one of whose roots references a `sourceId`
  that does not exist, or exists but is owned by a different user
- **THEN** the result is `Left(ServiceError.NotFound(_))`, and no pipeline, source, or run is
  created

#### Scenario: Every root is ownership-checked, not only the first
- **WHEN** `validate` is called with a proposal whose first root is owned by the caller and whose
  second root is owned by another user
- **THEN** the result is `Left(ServiceError.NotFound(_))` naming the second root, and nothing is created

### Requirement: Applying a pipeline proposal creates outputs and placements
Applying an accepted `PipelineProposal` SHALL create the proposed pipeline's steps and outputs, and
create dashboard placements for any proposed Output-backed panels, using the same single-
transaction create path as `POST /api/pipelines`.

#### Scenario: Apply creates outputs and placements atomically
- **WHEN** an accepted pipeline proposal containing outputs and dashboard placements is applied
- **THEN** the pipeline, its outputs, and the placements are created together, or none are, in one
  transaction

### Requirement: Applying a proposal creates its lanes and rejoins
Apply SHALL create sibling lanes and `lane`-kind secondary inputs expressed in the proposal, resolving
each referenced node from the request-scoped `clientId` of a step appearing earlier in the same
document. A `lane`-kind secondary input naming a `clientId` that is absent, or that appears later in
the document, SHALL be a named rejection that creates nothing.

#### Scenario: A two-lane proposal with a join rejoin applies
- **WHEN** a proposal expresses two lanes and a `join` step whose `lane`-kind secondary input names
  the second lane's terminal step by `clientId`
- **THEN** the created pipeline carries both lanes and the join step reads the named node as its
  second input

#### Scenario: A forward or dangling lane reference rolls back the whole apply
- **WHEN** a proposal's `join` step names a `clientId` that does not appear earlier in the same
  document
- **THEN** the apply fails with an error naming the unresolved `clientId` and nothing is created

### Requirement: Proposal Outputs are grounded at their own node, across lanes
Structural validation of a proposal SHALL evaluate each proposed Output's field mapping against the
schema projected at that Output's own node, including a rejoin node whose projected schema derives
from both of its incoming lanes rather than from its parent lane alone. An Output mapping a field
absent from its node's projected schema SHALL be reported with an error naming that node.

#### Scenario: An Output on a rejoin node is grounded against the rejoin schema
- **WHEN** a proposal places an Output on a `join` step, mapping a field contributed only by the
  join's `lane`-kind secondary input
- **THEN** validation accepts the Output, because the rejoin node's projected schema includes that
  field

#### Scenario: An Output mapping a field absent at its node is rejected
- **WHEN** a proposal places an Output on a lane's terminal step, mapping a field that exists only in
  a sibling lane and is never rejoined
- **THEN** validation reports an error naming that node, and nothing is created
