# pipeline-proposal-analyze-api Specification

## Purpose
Defines the dry-analyze contract for an unapplied `PipelineProposal` — projecting the source and
per-step output schema before anything is created, reusing the existing analyze engine and
inline-source inference/guard calls rather than a second, divergent implementation.

## Requirements

### Requirement: Dry analyze endpoint for a pipeline proposal
`POST /api/pipelines/analyze-proposal` SHALL accept a `PipelineProposal` request body and return a
projected source schema **per root**, per-node input/output schema across every lane, and any
per-node validation errors, without persisting a source, pipeline, root, or step, and without
running the pipeline. The projection SHALL carry one source-schema entry per root, identified by
that root's request position, matching the shape the persisted-pipeline analyze path already
returns, so the two cannot drift.

#### Scenario: A valid proposal with an existing source returns projected output columns
- **WHEN** a `PipelineProposal` whose single root references an existing, accessible `sourceId`, with
  a `steps` array, is posted to `/api/pipelines/analyze-proposal`
- **THEN** the response includes that root's source schema and each step's projected input/output
  schema, and no data source, pipeline, root, or pipeline step row is created

#### Scenario: A two-root proposal returns a source schema per root
- **WHEN** a proposal carrying two roots and a lane under each is posted
- **THEN** the response carries one source-schema entry per root and every node in both lanes carries
  a projection derived from its own root's schema

#### Scenario: A rejoin node projects from both incoming lanes
- **WHEN** a proposal's `join` step carries a `lane`-kind secondary input naming another lane's node
- **THEN** that node's projection reflects both incoming lanes rather than its parent lane alone

#### Scenario: A step with an invalid config surfaces a per-step validation error, not a 500
- **WHEN** a proposal's `steps` array includes an entry whose `config` is invalid for its `type`
- **THEN** the response is `200`, that step's `validationError` field is populated, and its output
  schema falls back to its input schema (matching the existing live-analyze identity-fallback rule)

#### Scenario: A structurally invalid proposal is rejected with 400
- **WHEN** the request body omits a `PipelineProposal`-required field (`pipelineName`, `roots`, or
  `steps`), or supplies the removed singular `source` field
- **THEN** the endpoint returns `400`

### Requirement: Inline source resolution reuses existing inference/guard calls
Analyzing a proposal with one or more inline roots SHALL resolve **each** such root's schema using
the same inference calls the existing source-creation/inference endpoints already use, not a second,
divergent implementation. A rejection SHALL name the offending root by its request position.

#### Scenario: Inline SQL source with a non-SELECT query is rejected before analysis
- **WHEN** a proposal's inline root has `type: "sql"` and a `config.query` containing a DDL/DML
  keyword (e.g. `DELETE`, `DROP`, `INSERT`)
- **THEN** the endpoint returns `400` before any query is executed

#### Scenario: Inline SQL source with a SELECT query analyzes successfully
- **WHEN** a proposal's inline root has `type: "sql"` and a `config.query` that is a `SELECT`
- **THEN** that root's source schema reflects the query's projected columns

#### Scenario: Inline static source resolves its schema from declared columns
- **WHEN** a proposal's inline root has `type: "static"` and a `config` with `columns`
- **THEN** that root's source schema matches those declared columns exactly, with no external call

#### Scenario: Inline CSV source is rejected with a clear 400
- **WHEN** a proposal's inline root has `type: "csv"`
- **THEN** the endpoint returns `400` with a message explaining that inline CSV sources require an
  uploaded file and cannot be dry-analyzed

#### Scenario: A recognized inline type with no matching config is rejected with 400, not 500
- **WHEN** a proposal's inline root has a recognized `type` (`sql`, `rest_api`, or `static`) but the
  request body omits that root's `config` entirely
- **THEN** the endpoint returns `400`, not an unhandled server error

#### Scenario: A fault in the second root is reported against that root
- **WHEN** a proposal's first root is a valid inline `static` spec and its second root is an inline
  `sql` spec with a non-SELECT query
- **THEN** the endpoint returns `400` naming the second root's request position

### Requirement: An existing sourceId takes precedence over an inline source
The endpoint SHALL resolve a root's schema from its existing `sourceId` when that root supplies both
an existing `sourceId` and an inline `type`/`config`, ignoring the inline fields in that case. This
rule applies per root, independently.

#### Scenario: Both sourceId and an inline type are present
- **WHEN** a proposal's root supplies an existing, accessible `sourceId` together with an inline
  `type` and `config`
- **THEN** that root's source schema is derived from the existing source, not the inline config

#### Scenario: Precedence is decided per root
- **WHEN** a proposal's first root supplies only an inline spec and its second supplies both a
  `sourceId` and an inline spec
- **THEN** the first root's schema comes from its inline spec and the second's from its existing
  source

### Requirement: Existing-source resolution is RLS-scoped
Resolving an existing `sourceId` referenced by **any** root of a proposal SHALL respect data-source
ownership; a `sourceId` the caller cannot access SHALL NOT leak another user's schema, regardless of
which root references it.

#### Scenario: A sourceId the caller does not own returns 404, not another user's schema
- **WHEN** a proposal references a `sourceId` owned by a different user
- **THEN** the endpoint returns `404` (no existence leak), and the response body contains no schema
  data derived from that source

#### Scenario: An unreadable second root returns 404 and leaks no schema for either root
- **WHEN** a proposal's first root references a source the caller owns and its second references one
  owned by another user
- **THEN** the endpoint returns `404` and the response body contains no schema data for either root

### Requirement: Proposal analysis grounds each Output at its own node
Pipeline proposal analysis SHALL call `PipelineAnalyzeService` at each proposed Output's specific
target node (not the pipeline trunk, and not its own lane's terminal node) to validate that Output's
`fieldMapping` against the schema actually available there. For an Output on a rejoin node, the
schema available there SHALL derive from both incoming lanes.

#### Scenario: Analysis rejects a fieldMapping invalid at its target node even if valid at the trunk
- **WHEN** a proposed Output's `fieldMapping` references a field present at the trunk but absent
  at its target tail node
- **THEN** proposal analysis reports that Output's mapping as invalid

#### Scenario: An Output on a rejoin node is grounded against the rejoin schema
- **WHEN** a proposed Output on a `join` node maps a field contributed only by that join's
  `lane`-kind secondary input
- **THEN** proposal analysis reports that Output's mapping as valid

#### Scenario: An Output mapping a field from a never-rejoined sibling lane is rejected
- **WHEN** a proposed Output on a lane's terminal node maps a field present only in a sibling lane
  that is never rejoined
- **THEN** proposal analysis reports that Output's mapping as invalid, naming that node
