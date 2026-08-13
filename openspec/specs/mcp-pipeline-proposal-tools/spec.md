# mcp-pipeline-proposal-tools Specification

## Purpose
Defines the MCP `propose_pipeline` / `analyze_pipeline_proposal` / `apply_pipeline_proposal` tools that
let an external agent draft, dry-analyze, and atomically apply a `PipelineProposal` against the backend
apply/analyze endpoints, mirroring the existing `propose_dashboard` → `apply_proposal` review flow.
## Requirements
### Requirement: propose_pipeline assembles and validates without writing
The MCP `propose_pipeline` tool SHALL assemble a `PipelineProposal` wire body from its typed input and return `{ proposal, warnings, applyReady }` without making any write call to the Helio backend.

#### Scenario: A minimal valid proposal returns applyReady true
- **WHEN** an agent calls `propose_pipeline` with a `pipelineName`, a `source` referencing an existing caller-owned `sourceId`, an `outputDataTypeName`, and an empty `steps` array
- **THEN** the tool returns `{ proposal, warnings: [], applyReady: true }` and makes no POST/PATCH/DELETE call

#### Scenario: An unknown sourceId produces a warning
- **WHEN** an agent calls `propose_pipeline` with a `source.sourceId` that does not resolve among the caller's data sources
- **THEN** the tool returns a warning naming the unresolved `sourceId` and `applyReady: false`, and makes no write call

#### Scenario: An inline source missing name or config produces a warning
- **WHEN** an agent calls `propose_pipeline` with `source.type` set but `source.name` blank/absent, or the type-matched `config` absent
- **THEN** the tool returns a warning describing the missing field and `applyReady: false`, and makes no write call

#### Scenario: Both sourceId and inline type set produces a warning
- **WHEN** an agent calls `propose_pipeline` with both `source.sourceId` and `source.type` set
- **THEN** the tool returns a warning and `applyReady: false`

#### Scenario: Neither sourceId nor inline type set produces a warning
- **WHEN** an agent calls `propose_pipeline` with `source.sourceId` and `source.type` both absent
- **THEN** the tool returns a warning and `applyReady: false`

### Requirement: analyze_pipeline_proposal projects the output schema without writing
The MCP `analyze_pipeline_proposal` tool SHALL call `POST /api/pipelines/analyze-proposal` with the supplied `PipelineProposal` and return the projected source/step schema, making no write call.

#### Scenario: A proposal's projected schema is returned
- **WHEN** an agent calls `analyze_pipeline_proposal` with a proposal whose steps are structurally valid
- **THEN** the tool returns the backend's `sourceName`/`outputDataTypeName`/`sourceSchema`/`steps` projection unchanged

### Requirement: apply_pipeline_proposal applies atomically and surfaces guardrail errors verbatim
The MCP `apply_pipeline_proposal` tool SHALL call `POST /api/pipelines/apply-proposal` with the supplied `PipelineProposal` and return the created source (if any), pipeline summary, output DataType id, and run result on success; any non-2xx response SHALL be surfaced as an error whose message includes the backend's response body verbatim, via the same `guarded` handling every other write tool in this file uses.

#### Scenario: A valid proposal applies successfully
- **WHEN** an agent calls `apply_pipeline_proposal` with a proposal that satisfies every backend guardrail
- **THEN** the tool returns the created/resolved source (if inline), pipeline summary, output DataType id, and run result

#### Scenario: A guardrail rejection is surfaced verbatim
- **WHEN** an agent calls `apply_pipeline_proposal` with a proposal whose inline `sql` source query is not read-only
- **THEN** the tool's result is an error whose text includes the backend's guardrail message unmodified, and the tool performs no client-side retry or interpretation of that failure

### Requirement: Tools are registered and consistent with existing tool conventions
`propose_pipeline`, `analyze_pipeline_proposal`, and `apply_pipeline_proposal` SHALL be registered in `helio-mcp/src/index.ts` and SHALL NOT alter the input/output contract of any existing MCP tool.

#### Scenario: Existing tools are unaffected
- **WHEN** the MCP server starts with this change applied
- **THEN** every previously-registered tool (e.g. `propose_dashboard`, `create_pipeline`, `add_pipeline_step`) accepts the same arguments and returns the same shape as before this change

