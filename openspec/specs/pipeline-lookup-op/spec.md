# pipeline-lookup-op Specification

## Purpose
Enrich pipeline rows with a few named columns from a small reference DataSource via a constrained
single-key left-join, without exposing `JoinStep`'s full join semantics.
## Requirements
### Requirement: Lookup op enriches rows via a single-key left-join against a reference DataSource
The execution engine SHALL support the `lookup` op. The step config SHALL contain
`referenceDataSourceId` (string: id of the reference `DataSource`), `sourceKey` (string: field name
on the current/left rows to match on), `lookupKey` (string: field name on the reference rows to
match on), and `columns` (array of strings: the reference-row field names to bring into the output).
At execute time the engine SHALL resolve the reference source via the privileged internal lookup
(`ctx.dataSourceRepo.findByIdInternal`), matching `JoinStep`/`UnionStep`'s resolution pattern — the
pipeline's ACL is the gate, not per-source ownership — and load its rows via `ctx.loadSource`. The
op SHALL be async (`Future`).

For each left row, the engine SHALL look up its `sourceKey` value in an index of reference rows
keyed by `lookupKey`. Only the fields named in `columns` SHALL be brought into the output row from
a matching reference row; every other left-row field SHALL be preserved unchanged.

#### Scenario: Matching row is enriched with only the named columns
- **WHEN** a lookup step with `{"referenceDataSourceId": "<id>", "sourceKey": "code", "lookupKey":
  "code", "columns": ["label"]}` is executed against current rows `[{"code": "A", "qty": 5}]` where
  the reference source has rows `[{"code": "A", "label": "Apple", "price": 1.5}]`
- **THEN** the output rows are `[{"code": "A", "qty": 5, "label": "Apple"}]` — `price` is not
  brought in, since it is not in `columns`

### Requirement: Lookup op is a left join — unmatched rows are preserved with null-filled columns
Rows with no matching reference row SHALL be preserved in the output, with every field named in
`columns` set to `null`. No row is dropped by the lookup step (left-join cardinality is always
preserved for the "0 matches" case).

#### Scenario: Unmatched row is null-filled, not dropped
- **WHEN** a lookup step with `{"referenceDataSourceId": "<id>", "sourceKey": "code", "lookupKey":
  "code", "columns": ["label"]}` is executed against current rows `[{"code": "B", "qty": 2}]` where
  the reference source has rows `[{"code": "A", "label": "Apple"}]` (no row with `code: "B"`)
- **THEN** the output rows are `[{"code": "B", "qty": 2, "label": null}]`

### Requirement: Lookup op resolves multiple reference matches by taking the first match
When more than one reference row matches a left row's `sourceKey` value, the engine SHALL use only
the first matching reference row's `columns` values (in the order rows were loaded from the
reference source) and SHALL NOT multiply the left row into multiple output rows.

#### Scenario: Duplicate reference keys use the first match, row count unchanged
- **WHEN** a lookup step with `{"referenceDataSourceId": "<id>", "sourceKey": "code", "lookupKey":
  "code", "columns": ["label"]}` is executed against current rows `[{"code": "A"}]` where the
  reference source has rows `[{"code": "A", "label": "First"}, {"code": "A", "label": "Second"}]`
- **THEN** the output rows are `[{"code": "A", "label": "First"}]` — exactly one output row, using
  the first matching reference row

### Requirement: Lookup op column collisions favor the brought-in reference value
The engine SHALL overwrite a left row's value with the brought-in reference value when a name in
`columns` collides with an existing field name on the left row.

#### Scenario: Reference value overwrites a colliding left-row field
- **WHEN** a lookup step with `{"referenceDataSourceId": "<id>", "sourceKey": "code", "lookupKey":
  "code", "columns": ["qty"]}` is executed against current rows `[{"code": "A", "qty": 5}]` where
  the reference source has rows `[{"code": "A", "qty": 99}]`
- **THEN** the output rows are `[{"code": "A", "qty": 99}]`

### Requirement: Lookup op fails descriptively on an unresolvable reference source
The engine SHALL fail execution with a descriptive error when `referenceDataSourceId` is missing,
invalid, or unresolvable (including the tolerant-decode default of an empty string), naming the
unresolved id.

#### Scenario: Missing referenceDataSourceId fails at execute time
- **WHEN** a lookup step is configured with `{"sourceKey": "code", "lookupKey": "code", "columns":
  ["label"]}` (no `referenceDataSourceId`) and the pipeline is executed
- **THEN** execution fails with a descriptive error identifying the empty/missing data source id

#### Scenario: Unresolvable referenceDataSourceId fails at execute time
- **WHEN** a lookup step is configured with `{"referenceDataSourceId": "does-not-exist",
  "sourceKey": "code", "lookupKey": "code", "columns": ["label"]}` and the pipeline is executed
- **THEN** execution fails with a descriptive error naming `does-not-exist` as not found

### Requirement: Lookup op analyze-inference appends the requested columns with best-effort typing
The `analyze_pipeline` endpoint SHALL infer, for a `lookup` step, an output schema equal to the
input schema with each name in `columns` appended (replacing any existing same-named field in
place), each typed `string` as a documented best-effort — the reference source's actual schema is
not resolved at analyze time (analyze has no repo access, matching `union`'s equivalent
limitation). This is a dedicated dispatch case (not the unknown-op fallback), so `analyze_pipeline`
SHALL NOT emit a `validationError` for a pipeline containing a `lookup` step solely because of the
op type.

#### Scenario: Analyze appends the requested columns typed string
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "lookup", "config":
  {"referenceDataSourceId": "<id>", "sourceKey": "code", "lookupKey": "code", "columns": ["label",
  "category"]}}` whose input schema contains fields `code` (string) and `qty` (integer)
- **THEN** the inferred output schema is exactly `code` (string), `qty` (integer), `label`
  (string), `category` (string) — and no `validationError` is present in the response

### Requirement: Lookup op is persisted via the standard pipeline_steps op CHECK constraint
The `pipeline_steps.op` column CHECK constraint SHALL accept `'lookup'` as a valid value, additive
to the existing set of accepted op strings. Existing pipeline steps and their persisted `op`
values SHALL be unaffected by this migration.

#### Scenario: A lookup step persists successfully
- **WHEN** a pipeline step with `op: "lookup"` is created via the pipeline steps API
- **THEN** the row is inserted successfully and round-trips on read

### Requirement: Frontend StepCard renders a lookup config editor and lookup is offered in the add-step picker
When a pipeline step has `op: "lookup"` and the step card is expanded, the frontend SHALL render an
editor with a reference-source picker (`referenceDataSourceId`), a `sourceKey` field selector
(sourced from the current step's input schema), and `lookupKey` / `columns` inputs for the
reference source's field names. Changing any control SHALL PATCH the step's persisted config with
the updated values. Like `union` and unlike `join`, `lookup` SHALL appear in the add-step picker
(`OP_TYPES`), since this change ships both a full editor and the symmetric ACL check for `lookup`'s
second-source reference.

#### Scenario: Editing the reference-source picker updates the step config
- **WHEN** the user selects a different data source in the reference-source picker for a lookup
  step
- **THEN** the step config is patched with the updated `referenceDataSourceId`, other fields
  unchanged

#### Scenario: Adding a column to bring in updates the step config
- **WHEN** the user adds a column name to the `columns` list for a lookup step
- **THEN** the step config is patched with the updated `columns` array

#### Scenario: Lookup is offered in the add-step picker
- **WHEN** the user opens the add-step picker to add a new pipeline step
- **THEN** `lookup` appears among the offered op choices

### Requirement: Lookup step reference-source reference must be caller-owned on creation and update
The backend SHALL verify that a `lookup` step's `config.referenceDataSourceId` refers to a data
source owned by the authenticated caller, on both `POST /api/pipelines/:id/steps` (creation) and
`PATCH /api/pipeline-steps/:id` (update), mirroring the checks HEL-278 (join) and HEL-384 (union)
already added. If the source does not exist or is not owned by the caller, the response SHALL be
`404 Not Found` (existence-not-leaked semantics) and the step SHALL NOT be persisted/updated. An
empty `referenceDataSourceId` (the "+ Add transformation step" picker's own default seed value —
`defaultConfigFor("lookup")`) is an incomplete draft, not a referenced-but-unowned source, and SHALL
NOT trigger the ownership check or the `404` response — creation/update SHALL succeed with the
reference source left unset, matching every other config type's `case _ => allow` fallback.

#### Scenario: Cross-user lookup step creation returns 404
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "lookup"` and
  `config.referenceDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted into `pipeline_steps`

#### Scenario: Own-source lookup step creation succeeds
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "lookup"` and
  `config.referenceDataSourceId` set to a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step

#### Scenario: Cross-user lookup step update returns 404
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own lookup step with
  `config.referenceDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** the step's persisted config is unchanged

#### Scenario: Lookup step creation with the picker's empty-default reference source succeeds
- **WHEN** a `lookup` step is created via `POST /api/pipelines/:id/steps` with
  `config.referenceDataSourceId` set to `""` (the add-step picker's default, unselected value)
- **THEN** the response is `201 Created` with the persisted step, `referenceDataSourceId` unset

#### Scenario: Clearing a lookup step's reference source back to empty on update stays allowed
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own lookup step, setting
  `config.referenceDataSourceId` to `""`
- **THEN** the response is `200 OK` with the persisted config's `referenceDataSourceId` set to `""`

### Requirement: MCP add_pipeline_step tool supports the lookup op
The `add_pipeline_step` MCP tool SHALL list `lookup` as a valid `op` value and document its config
shape (`referenceDataSourceId`, `sourceKey`, `lookupKey`, `columns`), so agent-driven pipeline
construction can add enrichment steps without direct API knowledge.

#### Scenario: MCP tool schema includes lookup
- **WHEN** an MCP client inspects the `add_pipeline_step` tool's input schema
- **THEN** `lookup` appears among the allowed `op` values in the tool description, with its config
  shape documented

