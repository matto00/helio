## MODIFIED Requirements

### Requirement: Workspace context endpoint
The system SHALL expose `GET /api/workspace/context`, mounted under the existing `WorkspaceRoutes`
`pathPrefix("workspace")`, returning a single JSON snapshot of the caller's data sources, DataTypes,
pipelines (with per-step output columns), and dashboards, structurally parallel to the MCP
`buildWorkspaceContext` `WorkspaceContext` interface (`helio-mcp/src/context.ts`), validating against
`schemas/workspace-context.schema.json`. The route SHALL accept an optional `budgetBytes` query
parameter (a non-negative integer) bounding the response's serialized size; when omitted, a
configured default budget applies.

#### Scenario: Authenticated caller fetches workspace context
- **WHEN** an authenticated user with at least one data source, DataType, pipeline, and dashboard
  calls `GET /api/workspace/context`
- **THEN** the response is `200` with a body containing `generatedAt`, `counts`, `dataSources`,
  `dataTypes`, `pipelines`, `dashboards`, `joinHints`, and `truncation`, matching
  `schemas/workspace-context.schema.json`

#### Scenario: Empty workspace returns empty collections, not an error
- **WHEN** an authenticated user with no data sources, DataTypes, pipelines, or dashboards calls
  `GET /api/workspace/context`
- **THEN** the response is `200` with `counts` all zero, every collection field an empty array, and
  `truncation.applied: false`

#### Scenario: Negative budgetBytes is rejected
- **WHEN** an authenticated user calls `GET /api/workspace/context?budgetBytes=-1`
- **THEN** the response is `400 Bad Request`

#### Scenario: budgetBytes of zero requests the smallest possible response
- **GIVEN** an authenticated user with at least one DataType carrying sample rows and column
  statistics
- **WHEN** that user calls `GET /api/workspace/context?budgetBytes=0`
- **THEN** the response is `200`, every `dataTypes[].sampleRows` is `[]`, every
  `dataTypes[].columnStats[*].exampleValues` is `[]`, `joinHints` is `[]`, and
  `truncation.structuralFloorExceedsBudget` is `true`

## ADDED Requirements

### Requirement: Deterministic, priority-ordered budget trimming
The system SHALL shrink the response in a fixed, documented priority order when its serialized size
exceeds the effective budget (the `budgetBytes` query parameter, or the configured default when
omitted): first `sampleRows` row count (uniformly across all DataTypes), then
`columnStats[*].exampleValues` list length (uniformly across all columns), then `joinHints` count —
re-measuring after each tier, stopping as soon as the response fits. Structural fields (resource
identity, `columns[]`, `columnStats[*]`'s scalar fields, pipeline steps, dashboards) SHALL NEVER be
shrunk or omitted to meet the budget. Given the same input and the same budget, the trimmed output
SHALL be byte-identical across repeated calls.

#### Scenario: A response within budget is returned unchanged
- **GIVEN** a workspace whose assembled response, at its natural (untrimmed) size, is smaller than
  the effective budget
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` and `columnStats[*].exampleValues`
  are at their natural (untrimmed) size, `joinHints` is unchanged, and `truncation.applied` is
  `false`

#### Scenario: Sample rows shrink before example values
- **GIVEN** a workspace whose assembled response exceeds the effective budget, and which fits the
  budget once every DataType's `sampleRows` is reduced to fewer than its natural count while every
  column's `exampleValues` remains at its natural size
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` array has fewer entries than its
  natural count (uniformly, the same cap applied to every DataType), and every column's
  `exampleValues` array is unchanged from its natural size

#### Scenario: Example values shrink only once sample rows are fully exhausted
- **GIVEN** a workspace whose assembled response still exceeds the effective budget even with every
  DataType's `sampleRows` reduced to `[]`
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` is `[]`, and every column's
  `exampleValues` array has fewer than its natural 5 entries (uniformly capped)

#### Scenario: Join hints shrink only once sample rows and example values are fully exhausted
- **GIVEN** a workspace whose assembled response still exceeds the effective budget even with every
  DataType's `sampleRows` reduced to `[]` and every column's `exampleValues` reduced to `[]`
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, every DataType's `sampleRows` and every column's `exampleValues`
  are `[]`, and `joinHints` has fewer entries than it would have had at its natural (untrimmed)
  length

#### Scenario: Structural identity survives even the tightest budget
- **GIVEN** a workspace whose assembled response exceeds the effective budget even after `sampleRows`,
  `exampleValues`, and `joinHints` are all fully emptied
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** the response is `200`, `counts` and every `dataSources[]`/`dataTypes[]`/`pipelines[]`/
  `dashboards[]` entry's identity and structural fields (id, name, `columns[]`, `columnStats[*]`'s
  `nullRate`/`distinctCount`/`distinctCountCapped`/`min`/`max`/`mean`, pipeline `steps[]`) are
  present and unchanged, and `truncation.structuralFloorExceedsBudget` is `true`

#### Scenario: Repeated calls with the same budget produce byte-identical trimmed output
- **GIVEN** a workspace whose underlying data has not changed and whose assembled response exceeds
  the effective budget
- **WHEN** `GET /api/workspace/context?budgetBytes=<N>` is called twice in succession by that
  workspace's owner, for the same `<N>`
- **THEN** both responses' bodies are byte-identical (aside from `generatedAt`)

### Requirement: Truncation is always reported, self-describing, and never silent
The response SHALL carry a `truncation` object, always present, reporting whether any value-level
trimming occurred, the effective `budgetBytes` used, the caps actually applied to `sampleRows` and
`exampleValues`, how many `joinHints` entries were dropped by budget trimming, and whether the
fully-trimmed structural floor still exceeds the budget. A consumer SHALL be able to determine from
`truncation` alone whether the response is a complete or partial view of the assembled context —
never by comparing field lengths itself.

#### Scenario: Untruncated response reports untouched caps
- **GIVEN** a workspace whose assembled response fits within the effective budget without trimming
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** `truncation.applied` is `false`, `truncation.sampleRowsCap` and
  `truncation.exampleValuesCap` equal their natural (untrimmed) maximums, and
  `truncation.joinHintsOmittedByBudget` is `0`

#### Scenario: Truncated response reports the caps actually applied
- **GIVEN** a workspace whose assembled response required `sampleRows` trimming to fit the effective
  budget
- **WHEN** `GET /api/workspace/context` is called by that workspace's owner
- **THEN** `truncation.applied` is `true` and `truncation.sampleRowsCap` is less than the natural
  (untrimmed) `sampleRows` maximum

### Requirement: List-truncation past Page.Default is explicit, not silent
The response's `truncation.paginationTruncatedResources` array SHALL list a resource kind
(`dataSources`/`dataTypes`/`dashboards`, each fetched with `Page.Default`) by name whenever that
kind's fetched page contains fewer items than that kind's true total (`counts.*`). This SHALL NOT
change `Page.Default`'s value or add new-request pagination — it only makes the existing,
pre-existing truncation self-describing.

#### Scenario: A workspace with more than 200 DataTypes reports pagination truncation
- **GIVEN** a workspace with more than 200 DataTypes
- **WHEN** the owner calls `GET /api/workspace/context`
- **THEN** the response is `200`, `dataTypes.length` is at most 200, `counts.dataTypes` exceeds
  `dataTypes.length`, and `truncation.paginationTruncatedResources` contains `"dataTypes"`

#### Scenario: A workspace within the page limit reports no pagination truncation
- **GIVEN** a workspace with fewer than 200 DataTypes, data sources, and dashboards
- **WHEN** the owner calls `GET /api/workspace/context`
- **THEN** `truncation.paginationTruncatedResources` is `[]`

### Requirement: Budget is configurable with a backward-compatible default
The default budget (applied when `budgetBytes` is omitted) SHALL be overridable via environment
configuration, and SHALL be generous enough that an existing small workspace's response is
unaffected by this change (`truncation.applied: false`).

#### Scenario: Small workspace is unaffected by the default budget
- **GIVEN** a workspace with a small number of DataTypes, each with a small number of sample rows
  and columns
- **WHEN** the owner calls `GET /api/workspace/context` with no `budgetBytes` param
- **THEN** the response is `200` and `truncation.applied` is `false`
