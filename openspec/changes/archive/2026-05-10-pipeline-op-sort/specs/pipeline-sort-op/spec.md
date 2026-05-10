## ADDED Requirements

### Requirement: Sort op executes multi-column stable sort
The backend `InProcessPipelineEngine` SHALL handle `op = "sort"` by sorting rows according to the
`sortBy` array in the config. Each element of `sortBy` is an object with `field` (string) and
`direction` ("asc" or "desc"). Rows are sorted stably; nulls sort last for both directions.
An empty `sortBy` array SHALL be treated as a no-op (all rows returned in original order).

#### Scenario: Single-column ascending sort
- **WHEN** a sort step with `{"sortBy": [{"field": "age", "direction": "asc"}]}` is applied to rows
- **THEN** rows are returned ordered by the `age` field ascending, with nulls last

#### Scenario: Single-column descending sort
- **WHEN** a sort step with `{"sortBy": [{"field": "name", "direction": "desc"}]}` is applied to rows
- **THEN** rows are returned ordered by the `name` field descending, with nulls last

#### Scenario: Multi-column sort (primary and secondary key)
- **WHEN** a sort step with `{"sortBy": [{"field": "country", "direction": "asc"}, {"field": "score", "direction": "desc"}]}` is applied
- **THEN** rows are first sorted by `country` ascending, then by `score` descending within each country group

#### Scenario: Empty sortBy is a no-op
- **WHEN** a sort step with `{"sortBy": []}` is applied
- **THEN** all rows are returned in their original order

#### Scenario: Null values sort last
- **WHEN** some rows have null for the sort field and a sort step is applied
- **THEN** null rows appear after all non-null rows, regardless of direction

### Requirement: Sort op is accepted by the pipeline steps API
The backend SHALL include `"sort"` in the set of valid ops accepted by `POST /api/pipelines/:id/steps`
and `PATCH /api/pipelines/:id/steps/:stepId`. A request with `op: "sort"` and a valid config SHALL
be persisted and return a success response.

#### Scenario: POST with op "sort" is accepted
- **WHEN** `POST /api/pipelines/:id/steps` is called with `op: "sort"` and `config: {"sortBy": []}`
- **THEN** the response is `201 Created` and the step is persisted with `op = 'sort'`

#### Scenario: Sort step schema is pass-through
- **WHEN** the analyze endpoint processes a pipeline containing a sort step
- **THEN** the sort step's outputSchema equals its inputSchema

### Requirement: SortConfig frontend component
The frontend SHALL provide a `SortConfig` component that renders an ordered list of sort keys.
Each sort key has a field selector (populated from `analyzeColumns`) and a direction toggle (asc/desc).
Users SHALL be able to add sort keys, remove individual sort keys, and reorder them.
The component SHALL call `onChange` with the updated `sortBy` array on every change.

#### Scenario: Add a sort key
- **WHEN** user clicks "Add sort key" in the SortConfig
- **THEN** a new row appears with an empty field selector and direction defaulting to "asc"

#### Scenario: Remove a sort key
- **WHEN** user clicks the remove button on a sort key row
- **THEN** that row is removed from the list and onChange is called with the updated array

#### Scenario: Change sort direction
- **WHEN** user toggles the direction on a sort key
- **THEN** the direction alternates between "asc" and "desc" and onChange is called

#### Scenario: Field selector populated from analyzeColumns
- **WHEN** SortConfig renders and analyzeColumns is non-empty
- **THEN** each field selector shows the available column names as options

### Requirement: Sort op wired into PipelineDetailPage
The frontend `PipelineDetailPage` SHALL render `SortConfig` when the selected step has `opType.id === "sort"`.
The `handleAddStep` function SHALL supply `{"sortBy": []}` as the initial config when creating a sort step.
The Sort op SHALL appear in the op menu with a recognizable label and icon.

#### Scenario: Sort step renders SortConfig
- **WHEN** a pipeline step with opType "sort" is selected in the editor
- **THEN** the SortConfig component renders with the current sortBy config

#### Scenario: New sort step has empty sortBy
- **WHEN** user adds a new "sort" step via the op dropdown
- **THEN** the step is created with config `{"sortBy": []}` and the SortConfig renders with zero sort keys
