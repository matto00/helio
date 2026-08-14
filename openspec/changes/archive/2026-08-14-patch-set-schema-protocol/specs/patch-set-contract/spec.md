## ADDED Requirements

### Requirement: PatchSet schema shape
`schemas/patch-set.schema.json` SHALL define a `PatchSet` object requiring `edits` (an ordered
array of `Edit`) and carrying an optional `summary` string. Each `Edit` SHALL require `target`
(an object with a required `kind`, one of `panel`/`dashboard`/`dataSource`/`dataType`/`pipeline`/
`pipelineStep`, and an optional `id`) and `op` (one of `update`/`delete`/`create`), plus an
optional `patch` object.

#### Scenario: A minimal valid patch set validates
- **WHEN** a JSON document supplies `edits` as a single-element array with a `target` of
  `{kind: "panel", id: "panel-1"}` and `op: "delete"`
- **THEN** the document validates against `schemas/patch-set.schema.json`

#### Scenario: A patch set missing `edits` is rejected
- **WHEN** a JSON document supplies only `summary`, omitting `edits`
- **THEN** the document fails validation against `schemas/patch-set.schema.json`

### Requirement: target.id is required for update/delete, optional for create
The schema SHALL require `target.id` whenever an `Edit`'s `op` is `update` or `delete`, and SHALL
NOT require it when `op` is `create` — expressed via a conditional (`if`/`then`) constraint,
mirroring the existing discriminated-shape pattern in `create-panel-request.schema.json`.

#### Scenario: An update edit without target.id is rejected
- **WHEN** an `Edit` has `op: "update"` and a `target` omitting `id`
- **THEN** the document fails validation against `schemas/patch-set.schema.json`

#### Scenario: A create edit without target.id validates
- **WHEN** an `Edit` has `op: "create"` and a `target` omitting `id`
- **THEN** the document validates against `schemas/patch-set.schema.json`

### Requirement: patch reuses existing per-resource request shapes
An `Edit`'s `patch` field SHALL NOT introduce new per-resource shapes. Its real shape, documented
per `(target.kind, op)` in the schema's own description rather than machine-`$ref`'d (none of the
six per-resource request shapes has an existing standalone schema file), SHALL be: for `op:
update`, the existing `UpdatePanelRequest`/`UpdateDashboardRequest`/`UpdateDataSourceRequest`/
`UpdateDataTypeRequest`/`UpdatePipelineRequest`/`UpdatePipelineStepRequest` shape matching
`target.kind`; for `op: create`, the matching `Create*Request` shape (decoded by a future apply
path, not this contract); for `op: delete`, `patch` is unused.

#### Scenario: An update edit's patch matches the target kind's existing PATCH shape
- **WHEN** an `Edit` has `target.kind: "dashboard"`, `op: "update"`, and `patch: {name: "Renamed"}`
- **THEN** the backend `PatchSetProtocol` decodes `patch` into the existing `UpdateDashboardRequest`
  case class — the same type `PATCH /api/dashboards/:id` already decodes

### Requirement: Backend protocol round-trips the schema, tolerating absent optionals
The backend SHALL provide `PatchSet`/`Edit`/`EditTarget` case classes and a
`RootJsonFormat[PatchSet]` (in `PatchSetProtocol`, mixed into `JsonProtocols`) that: reads a JSON
document missing `summary` or an `Edit`'s `patch` without error, treating the field as absent
rather than raising a deserialization error; and, on write, omits keys for absent fields rather
than emitting `null` — matching `DashboardProposalProtocol`/`PipelineProposalProtocol`'s existing
tolerant-reader convention.

#### Scenario: Round-trip a mixed patch set
- **WHEN** a `PatchSet` with a panel-update edit, a panel-delete edit, and a dashboard-layout-update
  edit is serialized to JSON and read back
- **THEN** the deserialized value equals the original

#### Scenario: Reading tolerates every optional field being absent
- **WHEN** a JSON object supplies only `edits` with a single delete edit, omitting `summary`
- **THEN** `PatchSet`'s reader succeeds, populating `summary` as `None`

### Requirement: Edit targets reference existing ids for update/delete; create is distinguished
The backend `Edit` reader SHALL raise a `deserializationError` when `op` is `update` or `delete`
and `target.id` is absent or blank, and SHALL NOT require `target.id` when `op` is `create`.

#### Scenario: Backend rejects an update edit with no target id
- **WHEN** `Edit`'s custom reader decodes a JSON object with `op: "update"` and a `target` omitting
  `id`
- **THEN** it raises a `deserializationError` naming the missing `target.id`

#### Scenario: Backend accepts a create edit with no target id
- **WHEN** `Edit`'s custom reader decodes a JSON object with `op: "create"` and a `target` omitting
  `id`
- **THEN** it succeeds, producing an `Edit` with `target.id = None`
