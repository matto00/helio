## ADDED Requirements

### Requirement: Dry analyze endpoint for a pipeline proposal
`POST /api/pipelines/analyze-proposal` SHALL accept a `PipelineProposal` request body and return the
projected source schema, per-step input/output schema, and any per-step validation errors, without
persisting a source, pipeline, or step, and without running the pipeline.

#### Scenario: A valid proposal with an existing source returns projected output columns
- **WHEN** a `PipelineProposal` referencing an existing, accessible `sourceId` and a `steps` array is
  posted to `/api/pipelines/analyze-proposal`
- **THEN** the response includes the source schema and each step's projected input/output schema,
  and no data source, pipeline, or pipeline step row is created

#### Scenario: A step with an invalid config surfaces a per-step validation error, not a 500
- **WHEN** a proposal's `steps` array includes an entry whose `config` is invalid for its `type`
- **THEN** the response is `200`, that step's `validationError` field is populated, and its output
  schema falls back to its input schema (matching the existing live-analyze identity-fallback rule)

#### Scenario: A structurally invalid proposal is rejected with 400
- **WHEN** the request body omits a `PipelineProposal`-required field (`pipelineName`, `source`,
  `outputDataTypeName`, or `steps`)
- **THEN** the endpoint returns `400`

### Requirement: Inline source resolution reuses existing inference/guard calls
Analyzing a proposal with an inline `source` SHALL resolve that source's schema using the same
inference calls the existing source-creation/inference endpoints already use, not a second,
divergent implementation.

#### Scenario: Inline SQL source with a non-SELECT query is rejected before analysis
- **WHEN** a proposal's inline `source` has `type: "sql"` and a `config.query` containing a DDL/DML
  keyword (e.g. `DELETE`, `DROP`, `INSERT`)
- **THEN** the endpoint returns `400` before any query is executed

#### Scenario: Inline SQL source with a SELECT query analyzes successfully
- **WHEN** a proposal's inline `source` has `type: "sql"` and a `config.query` that is a `SELECT`
- **THEN** the response's source schema reflects the query's projected columns

#### Scenario: Inline static source resolves its schema from declared columns
- **WHEN** a proposal's inline `source` has `type: "static"` and a `config` with `columns`
- **THEN** the response's source schema matches those declared columns exactly, with no external call

#### Scenario: Inline CSV source is rejected with a clear 400
- **WHEN** a proposal's inline `source` has `type: "csv"`
- **THEN** the endpoint returns `400` with a message explaining that inline CSV sources require an
  uploaded file and cannot be dry-analyzed

#### Scenario: A recognized inline type with no matching config is rejected with 400, not 500
- **WHEN** a proposal's inline `source` has a recognized `type` (`sql`, `rest_api`, or `static`) but
  the request body omits that source's `config` entirely
- **THEN** the endpoint returns `400`, not an unhandled server error

### Requirement: An existing sourceId takes precedence over an inline source
The endpoint SHALL resolve the schema from an existing `sourceId` when a proposal's `source` supplies
both an existing `sourceId` and an inline `type`/`config`, ignoring the inline fields in that case.

#### Scenario: Both sourceId and an inline type are present
- **WHEN** a proposal's `source` supplies an existing, accessible `sourceId` together with an inline
  `type` and `config`
- **THEN** the response's source schema is derived from the existing source, not the inline config

### Requirement: Existing-source resolution is RLS-scoped
Resolving an existing `sourceId` referenced by a proposal SHALL respect data-source ownership; a
`sourceId` the caller cannot access SHALL NOT leak another user's schema.

#### Scenario: A sourceId the caller does not own returns 404, not another user's schema
- **WHEN** a proposal references a `sourceId` owned by a different user
- **THEN** the endpoint returns `404` (no existence leak), and the response body contains no schema
  data derived from that source
