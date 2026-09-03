## MODIFIED Requirements

### Requirement: Lookup op enriches rows via a single-key left-join against a reference DataSource
The `lookup` step config SHALL contain `secondaryInput` (the discriminated object, exactly one of `{"kind": "source", "dataSourceId": "<id>"}` or `{"kind": "lane", "stepId": "<id>"}`) alongside `sourceKey`, `lookupKey` and `columns`. The legacy flat `referenceDataSourceId` field SHALL NOT be accepted. Enrichment behaviour SHALL be identical whether the reference rows come from a data source or from a referenced lane node's post-evaluation frame.

#### Scenario: A source-kind lookup enriches as before
- **WHEN** a lookup step with a `source`-kind `secondaryInput` is executed
- **THEN** the configured columns are merged onto matching current rows exactly as before

#### Scenario: A lane-kind lookup enriches from the referenced lane
- **WHEN** a lookup step declares `{"kind": "lane", "stepId": "<id>"}` and the referenced node's frame supplies matching rows on `lookupKey`
- **THEN** the configured columns are merged onto the current rows exactly as they would be from a data source

#### Scenario: The flat legacy field is rejected
- **WHEN** a lookup step config carrying `referenceDataSourceId` and no `secondaryInput` is decoded
- **THEN** decoding fails with a named error identifying the invalid config shape

#### Scenario: Matching row is enriched with only the named columns
- **WHEN** a lookup step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "sourceKey": "code", "lookupKey":
  "code", "columns": ["label"]}` is executed against current rows `[{"code": "A", "qty": 5}]` where
  the reference source has rows `[{"code": "A", "label": "Apple", "price": 1.5}]`
- **THEN** the output rows are `[{"code": "A", "qty": 5, "label": "Apple"}]` — `price` is not
  brought in, since it is not in `columns`

### Requirement: Lookup step reference-source reference must be caller-owned on creation and update
The backend SHALL verify that a `lookup` step's `config.secondaryInput`, when it is `source`-kind with a non-empty `dataSourceId`, refers to a data source owned by the authenticated caller, on both creation and update. If the source does not exist or is not owned by the caller, the response SHALL be `404 Not Found` and the step SHALL NOT be persisted/updated. An empty `dataSourceId` is an incomplete draft and SHALL NOT trigger the ownership check or the `404`. A `lane`-kind `secondaryInput` SHALL NOT be routed into this check.

#### Scenario: Cross-user lookup step creation returns 404
- **WHEN** user A creates a `lookup` step whose `source`-kind `secondaryInput` names a data source owned by user B
- **THEN** the response is `404 Not Found` and no step row is persisted

#### Scenario: Empty dataSourceId remains an incomplete draft
- **WHEN** a lookup step is created with `{"kind": "source", "dataSourceId": ""}`
- **THEN** creation succeeds with the reference source unset and no ownership check runs

#### Scenario: Own-source lookup step creation succeeds
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "lookup"` and
  `config.secondaryInput` (source-kind) set to a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step

#### Scenario: Cross-user lookup step update returns 404
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own lookup step with
  `config.secondaryInput` (source-kind) set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** the step's persisted config is unchanged

#### Scenario: Lookup step creation with the picker's empty-default reference source succeeds
- **WHEN** a `lookup` step is created via `POST /api/pipelines/:id/steps` with
  `config.secondaryInput` set to `{"kind": "source", "dataSourceId": ""}` (the add-step picker's default, unselected value)
- **THEN** the response is `201 Created` with the persisted step, `secondaryInput` left as an unset source-kind input

#### Scenario: Clearing a lookup step's reference source back to empty on update stays allowed
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own lookup step, setting
  `config.secondaryInput` (source-kind) to `""`
- **THEN** the response is `200 OK` with the persisted config's `secondaryInput` set to `{"kind": "source", "dataSourceId": ""}`

### Requirement: Lookup op is a left join — unmatched rows are preserved with null-filled columns
Rows with no matching reference row SHALL be preserved in the output, with every field named in
`columns` set to `null`. No row is dropped by the lookup step (left-join cardinality is always
preserved for the "0 matches" case).

#### Scenario: Unmatched row is null-filled, not dropped
- **WHEN** a lookup step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "sourceKey": "code", "lookupKey":
  "code", "columns": ["label"]}` is executed against current rows `[{"code": "B", "qty": 2}]` where
  the reference source has rows `[{"code": "A", "label": "Apple"}]` (no row with `code: "B"`)
- **THEN** the output rows are `[{"code": "B", "qty": 2, "label": null}]`

### Requirement: Lookup op resolves multiple reference matches by taking the first match
When more than one reference row matches a left row's `sourceKey` value, the engine SHALL use only
the first matching reference row's `columns` values (in the order rows were loaded from the
reference source) and SHALL NOT multiply the left row into multiple output rows.

#### Scenario: Duplicate reference keys use the first match, row count unchanged
- **WHEN** a lookup step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "sourceKey": "code", "lookupKey":
  "code", "columns": ["label"]}` is executed against current rows `[{"code": "A"}]` where the
  reference source has rows `[{"code": "A", "label": "First"}, {"code": "A", "label": "Second"}]`
- **THEN** the output rows are `[{"code": "A", "label": "First"}]` — exactly one output row, using
  the first matching reference row

### Requirement: Lookup op column collisions favor the brought-in reference value
The engine SHALL overwrite a left row's value with the brought-in reference value when a name in
`columns` collides with an existing field name on the left row.

#### Scenario: Reference value overwrites a colliding left-row field
- **WHEN** a lookup step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "sourceKey": "code", "lookupKey":
  "code", "columns": ["qty"]}` is executed against current rows `[{"code": "A", "qty": 5}]` where
  the reference source has rows `[{"code": "A", "qty": 99}]`
- **THEN** the output rows are `[{"code": "A", "qty": 99}]`

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
  {"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "sourceKey": "code", "lookupKey": "code", "columns": ["label",
  "category"]}}` whose input schema contains fields `code` (string) and `qty` (integer)
- **THEN** the inferred output schema is exactly `code` (string), `qty` (integer), `label`
  (string), `category` (string) — and no `validationError` is present in the response

### Requirement: Frontend StepCard renders a lookup config editor and lookup is offered in the add-step picker
When a pipeline step has `op: "lookup"` and the step card is expanded, the frontend SHALL render an
editor with a reference-source picker (`secondaryInput`), a `sourceKey` field selector
(sourced from the current step's input schema), and `lookupKey` / `columns` inputs for the
reference source's field names. Changing any control SHALL PATCH the step's persisted config with
the updated values. Like `union` and unlike `join`, `lookup` SHALL appear in the add-step picker
(`OP_TYPES`), since this change ships both a full editor and the symmetric ACL check for `lookup`'s
second-source reference.

#### Scenario: Editing the reference-source picker updates the step config
- **WHEN** the user selects a different data source in the reference-source picker for a lookup
  step
- **THEN** the step config is patched with the updated `secondaryInput`, other fields
  unchanged

#### Scenario: Adding a column to bring in updates the step config
- **WHEN** the user adds a column name to the `columns` list for a lookup step
- **THEN** the step config is patched with the updated `columns` array

#### Scenario: Lookup is offered in the add-step picker
- **WHEN** the user opens the add-step picker to add a new pipeline step
- **THEN** `lookup` appears among the offered op choices

### Requirement: MCP add_pipeline_step tool supports the lookup op
The `add_pipeline_step` MCP tool SHALL list `lookup` as a valid `op` value and document its config
shape (`secondaryInput`, `sourceKey`, `lookupKey`, `columns`), so agent-driven pipeline
construction can add enrichment steps without direct API knowledge.

#### Scenario: MCP tool schema includes lookup
- **WHEN** an MCP client inspects the `add_pipeline_step` tool's input schema
- **THEN** `lookup` appears among the allowed `op` values in the tool description, with its config
  shape documented

## ADDED Requirements

### Requirement: Lookup op fails descriptively on an unresolvable secondary input
The engine SHALL fail execution with a descriptive error when a `source`-kind `secondaryInput` has a `dataSourceId` that is empty, invalid, or unresolvable, naming the unresolved id; and when a `lane`-kind `secondaryInput` has a `stepId` that is empty, not a node of this pipeline, or unresolvable, naming the unresolved id.

#### Scenario: An unset source-kind input fails at execute time
- **WHEN** a lookup step configured with `{"secondaryInput": {"kind": "source", "dataSourceId": ""}, "sourceKey": "code", "lookupKey": "code", "columns": ["label"]}` is executed
- **THEN** execution fails with a descriptive error identifying the empty data source id

#### Scenario: An unresolvable source-kind input fails at execute time
- **WHEN** a lookup step configured with `{"secondaryInput": {"kind": "source", "dataSourceId": "does-not-exist"}, "sourceKey": "code", "lookupKey": "code", "columns": ["label"]}` is executed
- **THEN** execution fails with a descriptive error naming `does-not-exist` as not found

#### Scenario: An unresolvable lane-kind input fails at execute time
- **WHEN** a lookup step configured with `{"secondaryInput": {"kind": "lane", "stepId": "does-not-exist"}, "sourceKey": "code", "lookupKey": "code", "columns": ["label"]}` is executed
- **THEN** execution fails with a descriptive error naming `does-not-exist` as not a node of this pipeline

## REMOVED Requirements

### Requirement: Lookup op fails descriptively on an unresolvable reference source

**Reason:** Restated in terms of the discriminated `secondaryInput` shape (HEL-911), and extended to cover the new `lane`-kind input. The flat `referenceDataSourceId` field this requirement and both of its scenario titles are written against is deleted by this change, so the requirement is replaced rather than edited. The failure behaviour is preserved unchanged and broadened by "Lookup op fails descriptively on an unresolvable secondary input" above.

**Migration:** None.
