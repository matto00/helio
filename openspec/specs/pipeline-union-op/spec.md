# pipeline-union-op Specification

## Purpose
The `union` pipeline op stacks rows from a second, independently-resolved `DataSource` onto the
current pipeline (`byPosition` raw append or `byName` column-name alignment with null-backfill),
enforcing the same caller-owned ACL check on the second source that `join` has (HEL-278 parity).

## Requirements

### Requirement: Union op stacks rows from a second DataSource
The execution engine SHALL support the `union` op. The step config SHALL contain `secondaryInput` (the discriminated object, exactly one of `{"kind": "source", "dataSourceId": "<id>"}` or `{"kind": "lane", "stepId": "<id>"}`) and `mode` (string: one of `byPosition`, `byName`). The legacy flat `otherDataSourceId` field SHALL NOT be accepted. For a `source`-kind input the engine SHALL resolve the other source via the privileged internal lookup (`ctx.dataSourceRepo.findByIdInternal`), matching `JoinStep`'s resolution pattern — the pipeline's ACL is the gate, not per-source ownership — and load its rows via `ctx.loadSource`. For a `lane`-kind input the engine SHALL use the referenced node's post-evaluation frame. The op SHALL be async (`Future`), mirroring `JoinStep.evaluate`. Both modes SHALL behave identically regardless of which input kind supplied the second row set.

#### Scenario: byPosition appends rows with no column reconciliation
- **WHEN** a union step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "mode": "byPosition"}` is executed
  against current rows `[{"a": 1, "b": 2}]` where the other source has rows `[{"a": 3, "b": 4}]`
- **THEN** the output rows are `[{"a": 1, "b": 2}, {"a": 3, "b": 4}]`, in that order (current rows
  first, other-source rows appended)

#### Scenario: byName aligns on column names and backfills missing columns with null
- **WHEN** a union step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "mode": "byName"}` is executed against
  current rows `[{"a": 1, "b": 2}]` where the other source has rows `[{"a": 3, "c": 5}]`
- **THEN** the output rows are `[{"a": 1, "b": 2, "c": null}, {"a": 3, "b": null, "c": 5}]`

#### Scenario: byName with identical column sets behaves like byPosition
- **WHEN** a union step with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "mode": "byName"}` is executed against
  current rows `[{"a": 1, "b": 2}]` where the other source has rows `[{"a": 3, "b": 4}]`
- **THEN** the output rows are `[{"a": 1, "b": 2}, {"a": 3, "b": 4}]` — no null backfill occurs

#### Scenario: A lane-kind union stacks the referenced lane's rows
- **WHEN** a union step with `{"secondaryInput": {"kind": "lane", "stepId": "<id>"}, "mode": "byPosition"}` is executed against current rows `[{"a": 1}]` where the referenced node's frame is `[{"a": 9}]`
- **THEN** the output rows are `[{"a": 1}, {"a": 9}]`

#### Scenario: The flat legacy field is rejected
- **WHEN** a union step config carrying `otherDataSourceId` and no `secondaryInput` is decoded
- **THEN** decoding fails with a named error identifying the invalid config shape
- **THEN** no default, empty id, or coerced `source`-kind input is substituted

### Requirement: Union op analyze-inference is a documented best-effort passthrough
The `analyze_pipeline` endpoint SHALL infer a `union` step's output schema through a dedicated
dispatch case (not the unknown-op fallback). When the secondary input is `source`-kind, its schema is
not resolved at analyze time for `union`, and the inferred output schema SHALL equal the input schema
unchanged, with no `validationError`; this is a documented, intentional limitation (it also means the
timestamp/numeric collision check below cannot fire for a `source`-kind secondary). When the secondary
input is `lane`-kind and its schema is resolved, the inferred output schema SHALL be the input schema
followed by every secondary field whose name is not already present (on a name collision the parent
lane's type is projected).

#### Scenario: Analyze passes the input schema through unchanged
- **WHEN** `analyze_pipeline` is called for a pipeline step `{"op": "union", "config":
  {"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "mode": "byName"}}` whose input schema contains fields `a` (int) and
  `b` (int)
- **THEN** the inferred output schema is exactly `a` (int), `b` (int) — unchanged — and no
  `validationError` is present in the response

#### Scenario: A lane-kind secondary's new fields are appended
- **WHEN** analyze is called for a `union` step whose parent lane projects `{a: string, b: string}` and
  whose `lane`-kind secondary projects `{a: string, c: integer}`
- **THEN** the inferred output schema is `a` (string), `b` (string), `c` (integer)

### Requirement: Union op is persisted via the standard pipeline_steps op CHECK constraint
The `pipeline_steps.op` column CHECK constraint SHALL accept `'union'` as a valid value, additive
to the existing set of accepted op strings. Existing pipeline steps and their persisted `op`
values SHALL be unaffected by this migration.

#### Scenario: A union step persists successfully
- **WHEN** a pipeline step with `op: "union"` is created via the pipeline steps API
- **THEN** the row is inserted successfully and round-trips on read

### Requirement: Frontend StepCard renders a union config editor and union is offered in the add-step picker
When a pipeline step has `op: "union"` and the step card is expanded, the frontend SHALL render an
editor with an other-source picker (`secondaryInput`) and a mode toggle (`byPosition`/`byName`).
Changing either control SHALL PATCH the step's persisted config with the updated values. Unlike
`join` (excluded from `OP_TYPES` because it lacks a frontend config editor, not primarily for
security reasons — its cross-tenant exposure was already closed by HEL-278's creation/update-time
ACL check), `union` SHALL appear in the add-step picker (`OP_TYPES`), since this change ships both
a full editor and the symmetric ACL check for `union`'s second-source reference.

#### Scenario: Editing the other-source picker updates the step config
- **WHEN** the user selects a different data source in the other-source picker for a union step
- **THEN** the step config is patched with the updated `secondaryInput`, `mode` unchanged

#### Scenario: Toggling mode updates the step config
- **WHEN** the user switches the mode toggle from `byPosition` to `byName` for a union step
- **THEN** the step config is patched with `{"mode": "byName"}` merged into the existing
  `secondaryInput` value

#### Scenario: Union is offered in the add-step picker
- **WHEN** the user opens the add-step picker to add a new pipeline step
- **THEN** `union` appears among the offered op choices

### Requirement: MCP add_pipeline_step tool supports the union op
The `add_pipeline_step` MCP tool SHALL list `union` as a valid `op` value and document its config
shape (`secondaryInput`, `mode` with its two supported values), so agent-driven pipeline
construction can add row-stacking steps without direct API knowledge.

#### Scenario: MCP tool schema includes union
- **WHEN** an MCP client inspects the `add_pipeline_step` tool's input schema
- **THEN** `union` appears among the allowed `op` values in the tool description, with its config
  shape documented

### Requirement: Union op fails descriptively on an unresolvable secondary input or unsupported mode
The engine SHALL fail execution with a descriptive error when a `source`-kind `secondaryInput` has a `dataSourceId` that is empty, invalid, or unresolvable, naming the unresolved id; and when a `lane`-kind `secondaryInput` has a `stepId` that is empty, not a node of this pipeline, or unresolvable, naming the unresolved id. The engine SHALL similarly fail execution with a descriptive error when `mode` is not one of the two supported values, naming the invalid value and the two supported modes.

#### Scenario: An unset source-kind input fails at execute time
- **WHEN** a union step configured with `{"secondaryInput": {"kind": "source", "dataSourceId": ""}, "mode": "byPosition"}` is executed
- **THEN** execution fails with a descriptive error identifying the empty data source id

#### Scenario: An unresolvable source-kind input fails at execute time
- **WHEN** a union step configured with `{"secondaryInput": {"kind": "source", "dataSourceId": "does-not-exist"}, "mode": "byPosition"}` is executed
- **THEN** execution fails with a descriptive error naming `does-not-exist` as not found

#### Scenario: An unresolvable lane-kind input fails at execute time
- **WHEN** a union step configured with `{"secondaryInput": {"kind": "lane", "stepId": "does-not-exist"}, "mode": "byPosition"}` is executed
- **THEN** execution fails with a descriptive error naming `does-not-exist` as not a node of this pipeline

#### Scenario: Unsupported mode fails at execute time
- **WHEN** a union step configured with `{"secondaryInput": {"kind": "source", "dataSourceId": "<id>"}, "mode": "byColumn"}` is executed
- **THEN** execution fails with a descriptive error naming `byColumn` as unsupported and listing `byPosition` and `byName` as the supported modes

### Requirement: Union secondary-input ownership is checked only for source-kind inputs
The backend SHALL verify that a `union` step's `config.secondaryInput`, when it is `source`-kind with a non-empty `dataSourceId`, refers to a data source owned by the authenticated caller, on both `POST /api/pipelines/:id/steps` (creation) and `PATCH /api/pipeline-steps/:id` (update). If the source does not exist or is not owned by the caller, the response SHALL be `404 Not Found` (existence-not-leaked semantics) and the step SHALL NOT be persisted/updated. An empty `dataSourceId` is an incomplete draft, not a referenced-but-unowned source, and SHALL NOT trigger the ownership check or the `404`. A `lane`-kind `secondaryInput` SHALL NOT be routed into this check at all.

#### Scenario: Cross-user source-kind union creation returns 404
- **WHEN** user A creates a `union` step whose `source`-kind `secondaryInput` names a data source owned by user B
- **THEN** the response is `404 Not Found` and no step row is inserted

#### Scenario: Cross-user source-kind union update returns 404
- **WHEN** user A updates a `union` step's `secondaryInput` to a `source`-kind reference owned by user B
- **THEN** the response is `404 Not Found` and the step is not updated

#### Scenario: Own-source union creation succeeds
- **WHEN** user A creates a `union` step whose `source`-kind `secondaryInput` names a data source owned by user A
- **THEN** the response is `201 Created` with the persisted step

#### Scenario: Empty dataSourceId union creation succeeds
- **WHEN** a `union` step is created with `{"kind": "source", "dataSourceId": ""}`, the picker's incomplete-draft default
- **THEN** creation succeeds with the second source unset and no ownership check runs

#### Scenario: Clearing the source back to empty on update succeeds
- **WHEN** a `union` step's `secondaryInput` is updated to `{"kind": "source", "dataSourceId": ""}`
- **THEN** the update succeeds and no ownership check runs

#### Scenario: Lane-kind union input triggers no ownership check
- **WHEN** a `union` step is created with a `lane`-kind `secondaryInput` naming a step in the same pipeline
- **THEN** the step is persisted and no data-source ownership lookup is performed

### Requirement: Analyze flags a timestamp-versus-numeric field collision in a union
When a `union` step's secondary input schema is resolved (`lane`-kind), analyze SHALL report a
`validationError` for that step if a field name appears on both sides with type `timestamp` on one
side and `integer` or `float` on the other. The message SHALL name every such field and both of its
types, and SHALL suggest casting one side so the types match. The projected output schema SHALL be
the same as without the error. Every other same-name collision SHALL keep the parent lane's type with
no error. When the secondary schema is not resolved (including every `source`-kind secondary — a
known gap), no error is reported. The step's run-time behaviour is unchanged and runs are not blocked
by this error; it flags the disagreement, it does not prevent it.

#### Scenario: A numeric secondary field under a parent timestamp field is an analyze error
- **WHEN** analyze is called for a `union` step whose parent lane projects `ts: timestamp` and whose
  `lane`-kind secondary input projects `ts: integer`
- **THEN** the union step carries a `validationError` naming `ts`, `timestamp` and `integer`

#### Scenario: The reverse direction is also an error
- **WHEN** the parent lane projects `ts: float` and the `lane`-kind secondary projects `ts: timestamp`
- **THEN** the union step carries a `validationError` naming `ts`

#### Scenario: The run still mixes numbers into the column (flagged, not prevented)
- **WHEN** that union is run over a parent lane with timestamp-string `ts` values and a secondary
  lane with numeric `ts` values
- **THEN** the output `ts` column contains numbers, which is the disagreement the analyze error
  reports

#### Scenario: Other collisions are unchanged
- **WHEN** the colliding field is `string` on one side and `timestamp` on the other, or `integer`
  on one side and `float` on the other, or the same type on both sides
- **THEN** no `validationError` is reported and the parent lane's type is projected

#### Scenario: A source-kind secondary is not checked
- **WHEN** the union's secondary input is `source`-kind
- **THEN** no `validationError` is reported, whatever the source's field types (known gap)
