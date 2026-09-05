## MODIFIED Requirements

### Requirement: propose_pipeline assembles and validates without writing
The MCP `propose_pipeline` tool SHALL assemble a `PipelineProposal` wire body from its typed input and return `{ proposal, warnings, applyReady }` without making any write call to the Helio backend. Its input SHALL carry a non-empty `roots` array; the singular `source` field is removed outright and is not accepted.

#### Scenario: A minimal valid proposal returns applyReady true
- **WHEN** an agent calls `propose_pipeline` with a `pipelineName`, a one-element `roots` array whose element references an existing caller-owned `sourceId`, and an empty `steps` array
- **THEN** the tool returns `{ proposal, warnings: [], applyReady: true }` and makes no POST/PATCH/DELETE call

#### Scenario: A two-root proposal returns applyReady true
- **WHEN** an agent calls `propose_pipeline` with two `roots` — one referencing an existing caller-owned `sourceId`, one an inline source spec — and a lane under each
- **THEN** the tool returns `{ proposal, warnings: [], applyReady: true }`, the assembled proposal carries both roots in order, and no write call is made

#### Scenario: An unknown sourceId produces a warning
- **WHEN** an agent calls `propose_pipeline` with a `roots` element whose `sourceId` does not resolve among the caller's data sources
- **THEN** the tool returns a warning naming the unresolved `sourceId` and the offending root's position, and `applyReady: false`, and makes no write call

#### Scenario: An inline source missing name or config produces a warning
- **WHEN** an agent calls `propose_pipeline` with a `roots` element whose `type` is set but whose `name` is blank/absent, or whose type-matched `config` is absent
- **THEN** the tool returns a warning describing the missing field and the offending root's position, and `applyReady: false`, and makes no write call

#### Scenario: Both sourceId and inline type set produces a warning
- **WHEN** an agent calls `propose_pipeline` with a `roots` element setting both `sourceId` and `type`
- **THEN** the tool returns a warning and `applyReady: false`

#### Scenario: Neither sourceId nor inline type set produces a warning
- **WHEN** an agent calls `propose_pipeline` with a `roots` element setting neither `sourceId` nor `type`
- **THEN** the tool returns a warning and `applyReady: false`

#### Scenario: Every root is validated, not only the first
- **WHEN** an agent calls `propose_pipeline` with a valid first root and a second root setting neither `sourceId` nor `type`
- **THEN** the tool returns a warning addressing the second root and `applyReady: false`

#### Scenario: A proposal carrying the removed singular source is rejected
- **WHEN** an agent calls `propose_pipeline` with a `source` object and no `roots`
- **THEN** the tool reports a validation error naming the removed field and makes no write call

#### Scenario: An empty roots array produces a warning
- **WHEN** an agent calls `propose_pipeline` with `roots: []`
- **THEN** the tool returns a warning and `applyReady: false`

### Requirement: analyze_pipeline_proposal projects the output schema without writing
The MCP `analyze_pipeline_proposal` tool SHALL call `POST /api/pipelines/analyze-proposal` with the supplied `PipelineProposal` and return the projected per-root source schemas and per-node step projections, making no write call. The projection SHALL carry one entry per root rather than a single source schema, matching the shape the persisted-pipeline analyze path already returns, so the two cannot drift.

#### Scenario: A proposal's projected schema is returned
- **WHEN** an agent calls `analyze_pipeline_proposal` with a proposal whose steps are structurally valid
- **THEN** the tool returns the backend's per-root `sourceSchemas` and `steps` projection unchanged

#### Scenario: A two-root proposal projects a schema per root
- **WHEN** an agent calls `analyze_pipeline_proposal` with a two-root proposal carrying a lane under each root
- **THEN** the returned projection carries one source-schema entry per root, each identified by its root, and every node in both lanes carries a projection

#### Scenario: A rejoin node projects from both incoming lanes
- **WHEN** an agent calls `analyze_pipeline_proposal` with a proposal whose `join` step carries a `lane`-kind secondary input
- **THEN** that node's projection reflects both incoming lanes rather than its parent lane alone

### Requirement: apply_pipeline_proposal applies atomically and surfaces guardrail errors verbatim
The MCP `apply_pipeline_proposal` tool SHALL call `POST /api/pipelines/apply-proposal` with the supplied `PipelineProposal` and return the created sources (if any), pipeline summary, output Output id, and run result on success; any non-2xx response SHALL be surfaced as an error whose message includes the backend's response body verbatim, via the same `guarded` handling every other write tool in this file uses. Because a proposal may carry more than one inline root, the created-source field SHALL be a collection, not a single value.

#### Scenario: A valid proposal applies successfully
- **WHEN** an agent calls `apply_pipeline_proposal` with a proposal that satisfies every backend guardrail
- **THEN** the tool returns the created/resolved sources (if any inline root), pipeline summary, output Output id, and run result

#### Scenario: A two-root proposal reports every source it created
- **WHEN** an agent calls `apply_pipeline_proposal` with a proposal carrying two inline roots
- **THEN** the tool returns both created sources, and the pipeline summary reports both roots in proposal order

#### Scenario: A guardrail rejection is surfaced verbatim
- **WHEN** an agent calls `apply_pipeline_proposal` with a proposal whose inline `sql` source query is not read-only
- **THEN** the tool's result is an error whose text includes the backend's guardrail message unmodified, and the tool performs no client-side retry or interpretation of that failure

#### Scenario: An unresolvable root surfaces the backend's rollback error
- **WHEN** an agent calls `apply_pipeline_proposal` with a proposal whose second root names an unreadable source
- **THEN** the tool's result is an error carrying the backend's message verbatim, and nothing was created

## ADDED Requirements

### Requirement: Pipeline proposal tools accept multi-root, multi-lane proposals
`propose_pipeline`, `analyze_pipeline_proposal`, and `apply_pipeline_proposal` SHALL accept a
proposal expressing sibling lanes and `lane`-kind secondary inputs on `join`/`union`/`lookup`, with
intra-proposal references resolved against request-scoped `clientId`s. Client-side validation SHALL
address a failure to the specific root or step that caused it, never to the first element by default.

#### Scenario: A proposal expressing two lanes and a rejoin passes client-side validation
- **WHEN** `propose_pipeline` is given a proposal with two lanes and a `join` step whose `lane`-kind secondary input names the second lane's terminal step by `clientId`
- **THEN** validation passes and the assembled proposal preserves both lanes and the rejoin reference

#### Scenario: A dangling lane reference is reported against its step
- **WHEN** a proposal's `join` step names a `lane`-kind secondary input `clientId` absent from the proposal
- **THEN** validation fails with a warning naming that step's position and the unresolved `clientId`
