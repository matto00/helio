# proposal-dry-run-validation Specification

## Purpose
Guarantees that a proposal accepted at propose time (assistant, HTTP or MCP) passes every pre-write check apply runs,
because propose runs apply's own checks as a dry run that writes nothing.

## Requirements

### Requirement: Propose runs apply's pre-write checks as a dry run
Pipeline, combined, dashboard and patch-set proposal validation SHALL run the same check functions apply runs before
its first write, writing nothing, and SHALL reject with apply's message. Excluded, and each listed with its reason in
the change's apply-check inventory: the pipeline run itself (row reads); any check the inventory records as apply-only
with a reason (cycle guards, sentinel-panel controls, if so decided). Patch-set `pipeline` create edits ARE covered,
including their Outputs' fieldMapping column check and, when the create has roots but no steps or Outputs, its inline
roots' create checks. Patch-set `pipelineStep` create and update edits and `dataSource` create and update edits ARE
covered: preview SHALL call the same check function `PipelineService.addStep`, `PipelineService.updateStep`,
`DataSourceService.createStatic` and `DataSourceService.update` call before their first write. When an earlier edit of
the same patch set creates, updates or deletes a step of the same pipeline, a later step edit's graph-dependent checks
(placement, lane, re-parent refusal) run at apply only, so apply never refuses a set it accepts today; the inventory
records each such check.

#### Scenario: Output maps a column missing at its node
- **WHEN** a pipeline or combined proposal has an Output whose `fieldMapping` names a column that is absent from its
  target node's analyzed schema (for example dropped by an upstream `select`, or never in the source)
- **THEN** propose rejects it with `fieldMapping references column(s) not present at this node: <cols>. Available
  columns: <list>`, the same message apply returns, and nothing is created

#### Scenario: Parity with apply
- **WHEN** a corpus of proposals covering every check family is run through propose and through apply
- **THEN** propose accepts a proposal if and only if apply succeeds (the exclusions above aside), and each rejection
  carries apply's message, except that a column-check failure on a node descending from a root whose schema could not
  be fetched carries a clearer fetch message

#### Scenario: Source schema fetch failure keeps apply's acceptance
- **WHEN** an inline rest/sql root's schema cannot be fetched and no Output's column check fails against an empty
  schema for that root (for example the mapped Output sits on another, healthy root)
- **THEN** propose accepts, as apply does (apply records an unrunnable run)

#### Scenario: Patch-set pipeline create with a missing column
- **WHEN** a patch set's `pipeline` create edit has an Output mapping a column absent at its node
- **THEN** preview rejects it with the column-existence message, as apply would

#### Scenario: Patch-set pipeline create with roots only
- **WHEN** a patch set's `pipeline` create edit has an inline static, sql or rest root that its create check refuses
  and no steps or Outputs
- **THEN** preview rejects it with that create check's message, as apply would

#### Scenario: Patch-set step create refused by placement
- **WHEN** a patch set's `pipelineStep` create names a `parentStepId` that is not a step of the target pipeline (or any
  other placement `addStep` refuses)
- **THEN** preview rejects it with `addStep`'s message prefixed `edit N: `, and nothing is written

#### Scenario: Patch-set step create or update refused by a lane reference
- **WHEN** a patch set's `pipelineStep` create or update carries a `lane` secondary input naming the step itself, an
  ancestor, or a step that depends on it
- **THEN** preview rejects it with the message `addStep` or `updateStep` returns, prefixed `edit N: `

#### Scenario: Patch-set step update that changes the step type
- **WHEN** a patch set's `pipelineStep` update carries a `type` different from the stored step's kind
- **THEN** preview rejects it with `updateStep`'s type-change message, prefixed `edit N: `

#### Scenario: Same-pipeline step edits in one patch set still apply
- **WHEN** a patch set creates a step at `position: N` and then another at `position: N+1` on a pipeline of N steps
- **THEN** preview accepts it and apply applies both edits, as before this change

#### Scenario: Patch-set data-source create or update refused by its service check
- **WHEN** a patch set's `dataSource` create fails `validateStatic` (bad column type, bad default, invalid row, or
  more rows than the dataset row cap), or its `dataSource` update sets a blank name
- **THEN** preview rejects it with the service's message prefixed `edit N: `

#### Scenario: Apply runs the same dry run first
- **WHEN** apply receives a proposal the dry run rejects
- **THEN** apply returns that rejection before creating any source, pipeline or dashboard

### Requirement: Dry-run failures reach the agent as tool errors
An assistant `propose_*` tool call rejected by the dry run SHALL return an `is_error` tool_result carrying the
rejection message, so the agent can correct and re-propose within the same turn, and no proposal SHALL be captured.

#### Scenario: Agent repairs a bad mapping in one turn
- **WHEN** the agent's first `propose_pipeline` maps `display_name` at a node without it and its second maps an
  existing column
- **THEN** the first tool_result is `is_error` and names the available columns, and the turn ends with the second
  proposal captured

### Requirement: Validate routes and MCP use the dry run
`POST /api/pipelines/validate-proposal`, `POST /api/dashboards/validate-proposal` and `POST /api/proposals/validate`
SHALL run the matching dry run with the apply route's authentication, returning `200 {"valid": true}` or apply's error
status and message. helio-mcp `propose_pipeline` and `propose_dashboard` SHALL call them and return an `isError`
result on rejection.

#### Scenario: MCP propose_pipeline with a missing column
- **WHEN** an external agent calls MCP `propose_pipeline` with an Output mapping a missing column
- **THEN** the tool result is an error carrying the backend's column-existence message
