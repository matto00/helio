## MODIFIED Requirements

### Requirement: apply_pipeline_proposal applies atomically and surfaces guardrail errors verbatim
The MCP `apply_pipeline_proposal` tool SHALL call `POST /api/pipelines/apply-proposal` with the supplied `PipelineProposal` and return the created sources (if any), pipeline summary, output Output id, and run result on success; any non-2xx response SHALL be surfaced as an error whose message includes the backend's response body verbatim, via the same `guarded` handling every other write tool in this file uses. Because a proposal may carry more than one inline root, the created-source field SHALL be a collection, not a single value. The run result SHALL be passed through unchanged: its `rows` is a preview of at most 10 rows, `rowCount` the total and `rowsTruncated` the cut flag, and the tool description SHALL say so.

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
