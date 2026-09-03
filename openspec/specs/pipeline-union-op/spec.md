# pipeline-union-op Specification

## Purpose
The `union` pipeline op stacks rows from a second, independently-resolved `DataSource` onto the
current pipeline (`byPosition` raw append or `byName` column-name alignment with null-backfill),
enforcing the same caller-owned ACL check on the second source that `join` has (HEL-278 parity).

## Requirements

### Requirement: Union op stacks rows from a second DataSource
The execution engine SHALL support the `union` op. The step config SHALL contain
`otherDataSourceId` (string: id of the second `DataSource` to stack onto the current row set) and
`mode` (string: one of `byPosition`, `byName`). At execute time the engine SHALL resolve the other
source via the privileged internal lookup (`ctx.dataSourceRepo.findByIdInternal`), matching
`JoinStep`'s resolution pattern — the pipeline's ACL is the gate, not per-source ownership — and
load its rows via `ctx.loadSource`. The op SHALL be async (`Future`), mirroring `JoinStep.evaluate`.

#### Scenario: byPosition appends rows with no column reconciliation
- **WHEN** a union step with `{"otherDataSourceId": "<id>", "mode": "byPosition"}` is executed
  against current rows `[{"a": 1, "b": 2}]` where the other source has rows `[{"a": 3, "b": 4}]`
- **THEN** the output rows are `[{"a": 1, "b": 2}, {"a": 3, "b": 4}]`, in that order (current rows
  first, other-source rows appended)

#### Scenario: byName aligns on column names and backfills missing columns with null
- **WHEN** a union step with `{"otherDataSourceId": "<id>", "mode": "byName"}` is executed against
  current rows `[{"a": 1, "b": 2}]` where the other source has rows `[{"a": 3, "c": 5}]`
- **THEN** the output rows are `[{"a": 1, "b": 2, "c": null}, {"a": 3, "b": null, "c": 5}]` — each
  row is backfilled with `null` for keys present in the other side's row shape but absent from its
  own

#### Scenario: byName with identical column sets behaves like byPosition
- **WHEN** a union step with `{"otherDataSourceId": "<id>", "mode": "byName"}` is executed against
  current rows `[{"a": 1, "b": 2}]` where the other source has rows `[{"a": 3, "b": 4}]`
- **THEN** the output rows are `[{"a": 1, "b": 2}, {"a": 3, "b": 4}]` — no null backfill occurs
  since both sides share the same column set

### Requirement: Union op fails descriptively on unresolvable source or unsupported mode
The engine SHALL fail execution with a descriptive error when `otherDataSourceId` is missing,
invalid, or unresolvable (including the tolerant-decode default of an empty string), naming the
unresolved id. The engine SHALL similarly fail execution with a descriptive error when `mode` is
not one of the two supported values, naming the invalid value and the two supported modes.

#### Scenario: Missing otherDataSourceId fails at execute time
- **WHEN** a union step is configured with `{"mode": "byPosition"}` (no `otherDataSourceId`) and the
  pipeline is executed
- **THEN** execution fails with a descriptive error identifying the empty/missing data source id

#### Scenario: Unresolvable otherDataSourceId fails at execute time
- **WHEN** a union step is configured with `{"otherDataSourceId": "does-not-exist", "mode":
  "byPosition"}` and the pipeline is executed
- **THEN** execution fails with a descriptive error naming `does-not-exist` as not found

#### Scenario: Unsupported mode fails at execute time
- **WHEN** a union step is configured with `{"otherDataSourceId": "<id>", "mode": "byColumn"}` and
  the pipeline is executed
- **THEN** execution fails with a descriptive error naming `byColumn` as unsupported and listing
  `byPosition` and `byName` as the supported modes

### Requirement: Union op analyze-inference is a documented best-effort passthrough
The `analyze_pipeline` endpoint SHALL infer, for a `union` step, an output schema equal to the
input schema unchanged. This is a dedicated dispatch case (not the unknown-op fallback), so
`analyze_pipeline` SHALL NOT emit a `validationError` for a pipeline containing a `union` step. The
other source's actual schema is not resolved at analyze time (analyze has no repo access); this is
a documented, intentional limitation, not a defect.

#### Scenario: Analyze passes the input schema through unchanged
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "union", "config":
  {"otherDataSourceId": "<id>", "mode": "byName"}}` whose input schema contains fields `a` (int) and
  `b` (int)
- **THEN** the inferred output schema is exactly `a` (int), `b` (int) — unchanged — and no
  `validationError` is present in the response

### Requirement: Union op is persisted via the standard pipeline_steps op CHECK constraint
The `pipeline_steps.op` column CHECK constraint SHALL accept `'union'` as a valid value, additive
to the existing set of accepted op strings. Existing pipeline steps and their persisted `op`
values SHALL be unaffected by this migration.

#### Scenario: A union step persists successfully
- **WHEN** a pipeline step with `op: "union"` is created via the pipeline steps API
- **THEN** the row is inserted successfully and round-trips on read

### Requirement: Frontend StepCard renders a union config editor and union is offered in the add-step picker
When a pipeline step has `op: "union"` and the step card is expanded, the frontend SHALL render an
editor with an other-source picker (`otherDataSourceId`) and a mode toggle (`byPosition`/`byName`).
Changing either control SHALL PATCH the step's persisted config with the updated values. Unlike
`join` (excluded from `OP_TYPES` because it lacks a frontend config editor, not primarily for
security reasons — its cross-tenant exposure was already closed by HEL-278's creation/update-time
ACL check), `union` SHALL appear in the add-step picker (`OP_TYPES`), since this change ships both
a full editor and the symmetric ACL check for `union`'s second-source reference.

#### Scenario: Editing the other-source picker updates the step config
- **WHEN** the user selects a different data source in the other-source picker for a union step
- **THEN** the step config is patched with the updated `otherDataSourceId`, `mode` unchanged

#### Scenario: Toggling mode updates the step config
- **WHEN** the user switches the mode toggle from `byPosition` to `byName` for a union step
- **THEN** the step config is patched with `{"mode": "byName"}` merged into the existing
  `otherDataSourceId` value

#### Scenario: Union is offered in the add-step picker
- **WHEN** the user opens the add-step picker to add a new pipeline step
- **THEN** `union` appears among the offered op choices

### Requirement: Union step second-source reference must be caller-owned on creation and update
The backend SHALL verify that a `union` step's `config.otherDataSourceId` refers to a data source
owned by the authenticated caller, on both `POST /api/pipelines/:id/steps` (creation) and
`PATCH /api/pipeline-steps/:id` (update), mirroring the check HEL-278 already added for
`JoinConfig.rightDataSourceId`. If the source does not exist or is not owned by the caller, the
response SHALL be `404 Not Found` (existence-not-leaked semantics) and the step SHALL NOT be
persisted/updated. An empty `otherDataSourceId` (the "+ Add transformation step" picker's own
default seed value — `defaultConfigFor("union")`) is an incomplete draft, not a referenced-but-
unowned source, and SHALL NOT trigger the ownership check or the `404` response — creation/update
SHALL succeed with the second source left unset, matching `pipeline-lookup-op`'s identical
`referenceDataSourceId` behavior and every other config type's `case _ => allow` fallback.

#### Scenario: Cross-user union step creation returns 404
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "union"` and
  `config.otherDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** no step row is inserted into `pipeline_steps`

#### Scenario: Own-source union step creation succeeds
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "union"` and
  `config.otherDataSourceId` set to a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step

#### Scenario: Cross-user union step update returns 404
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own union step with
  `config.otherDataSourceId` set to a data source owned by user B
- **THEN** the response is `404 Not Found`
- **THEN** the step's persisted config is unchanged

#### Scenario: Empty otherDataSourceId union step creation succeeds (picker default)
- **WHEN** user A calls `POST /api/pipelines/:id/steps` with `type: "union"` and
  `config.otherDataSourceId` set to `""` (the picker's default seed value)
- **THEN** the response is `201 Created` with the persisted step
- **THEN** no ownership check is attempted against the empty id

#### Scenario: Update to empty otherDataSourceId succeeds
- **WHEN** user A calls `PATCH /api/pipeline-steps/:id` on their own union step with
  `config.otherDataSourceId` set to `""`
- **THEN** the response is `200 OK` with the step's `otherDataSourceId` persisted as empty

### Requirement: MCP add_pipeline_step tool supports the union op
The `add_pipeline_step` MCP tool SHALL list `union` as a valid `op` value and document its config
shape (`otherDataSourceId`, `mode` with its two supported values), so agent-driven pipeline
construction can add row-stacking steps without direct API knowledge.

#### Scenario: MCP tool schema includes union
- **WHEN** an MCP client inspects the `add_pipeline_step` tool's input schema
- **THEN** `union` appears among the allowed `op` values in the tool description, with its config
  shape documented
