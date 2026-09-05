## MODIFIED Requirements

### Requirement: target.id is required for update/delete, optional for create
The schema SHALL require `target.id` whenever an `Edit`'s `op` is `update` or `delete`, and SHALL
NOT require it when `op` is `create` — expressed via a conditional (`if`/`then`) constraint,
mirroring the existing discriminated-shape pattern in `create-panel-request.schema.json`.

`target` SHALL additionally carry an optional `parentId`, naming the parent resource a
not-yet-existing resource is created under. `parentId` SHALL be required and non-blank for `op:
create` on a kind whose create route takes its parent from the URL path, and SHALL be absent for
`op: update` and `op: delete`, where the resource's own `target.id` already locates it. A `parentId`
supplied on an `update` or `delete` edit SHALL be rejected rather than ignored.

This closes the gap that previously made a `create` op impossible for any child resource: the create
request bodies carry no parent id of their own, because the real routes take it from the path, and
`EditTarget` had no field for one.

#### Scenario: An update edit without target.id is rejected
- **WHEN** an `Edit` has `op: "update"` and a `target` omitting `id`
- **THEN** the document fails validation against `schemas/patch-sets/patch-set.schema.json`

#### Scenario: A create edit without target.id validates
- **WHEN** an `Edit` has `op: "create"` and a `target` omitting `id`
- **THEN** the document validates against `schemas/patch-sets/patch-set.schema.json`

#### Scenario: A create edit without parentId on a child kind is rejected
- **WHEN** an edit supplies `op: "create"` for `pipelineStep` with no `parentId`
- **THEN** the patch set fails to decode with a named error identifying the missing parent

#### Scenario: parentId on an update edit is rejected
- **WHEN** an edit supplies `op: "update"`, a `target.id`, and a `parentId`
- **THEN** the patch set fails to decode with a named error rather than silently dropping the field

### Requirement: Backend protocol round-trips the schema, tolerating absent optionals
The backend SHALL provide `PatchSet`/`Edit`/`EditTarget` case classes and a
`RootJsonFormat[PatchSet]` (in `PatchSetProtocol`, mixed into `JsonProtocols`) that: reads a JSON
document missing `summary`, an `Edit`'s `patch`, or an `EditTarget`'s `parentId` without error,
treating the field as absent rather than raising a deserialization error; and, on write, omits keys
for absent fields rather than emitting `null` — matching
`DashboardProposalProtocol`/`PipelineProposalProtocol`'s existing tolerant-reader convention.

Tolerance of an absent `parentId` is a **wire-level** rule only: the reader does not raise on its
absence in general, because it is absent on every `update` and `delete` edit. The requirement that
`parentId` be present for a child-kind `create` is enforced as a validation rule, so its absence
there is a named error rather than a decode failure.

#### Scenario: Round-trip a mixed patch set
- **WHEN** a `PatchSet` with a panel-update edit, a panel-delete edit, and a dashboard-layout-update
  edit is serialized to JSON and read back
- **THEN** the deserialized value equals the original

#### Scenario: Round-trip a patch set carrying a create edit with a parentId
- **WHEN** a `PatchSet` containing a `pipelineStep` create edit whose `target` carries a `parentId`
  is serialized to JSON and read back
- **THEN** the deserialized value equals the original, `parentId` included

#### Scenario: Reading tolerates every optional field being absent
- **WHEN** a JSON object supplies only `edits` with a single delete edit, omitting `summary`
- **THEN** `PatchSet`'s reader succeeds, populating `summary` as `None`

#### Scenario: An absent parentId on an update edit decodes as None
- **WHEN** a JSON object supplies an update edit whose `target` omits `parentId`
- **THEN** the reader succeeds, populating `parentId` as `None`

#### Scenario: Writing omits an absent parentId rather than emitting null
- **WHEN** an `Edit` whose `target.parentId` is `None` is serialized
- **THEN** the emitted `target` object carries no `parentId` key

### Requirement: PatchSet schema shape
`schemas/patch-sets/patch-set.schema.json` SHALL define a `PatchSet` object requiring `edits` (an ordered
array of `Edit`) and carrying an optional `summary` string. Each `Edit` SHALL require `target`
(an object with a required `kind`, one of `panel`/`dashboard`/`dataSource`/`pipeline`/
`pipelineStep`/`output`, an optional `id`, and an optional `parentId` naming the parent resource a
not-yet-existing resource is created under) and `op` (one of `update`/`delete`/`create`), plus an
optional `patch` object.

#### Scenario: A minimal valid patch set validates
- **WHEN** a JSON document supplies `edits` as a single-element array with a `target` of
  `{kind: "panel", id: "panel-1"}` and `op: "delete"`
- **THEN** the document validates against `schemas/patch-sets/patch-set.schema.json`

#### Scenario: A create edit carrying a parentId validates
- **WHEN** a JSON document supplies a single `Edit` with a `target` of
  `{kind: "pipelineStep", parentId: "pipeline-1"}` and `op: "create"`
- **THEN** the document validates against `schemas/patch-sets/patch-set.schema.json`

#### Scenario: A patch set missing `edits` is rejected
- **WHEN** a JSON document supplies only `summary`, omitting `edits`
- **THEN** the document fails validation against `schemas/patch-sets/patch-set.schema.json`

## ADDED Requirements

### Requirement: pipelineStep supports a create op
`pipelineStep` SHALL be a valid `target.kind` for `op: create`, with the new step's parent pipeline
named by `target.parentId` and its body carried in the untyped create patch, decoded at apply time
against the existing create-step request shape. The created step MAY name a sibling's parent, which
is how a new lane is expressed.

`output` SHALL remain without a `create` op. The `EditTarget` extension above makes one
representable, but this change neither implements nor tests it, and an untested op is worse than a
documented absence.

#### Scenario: A create edit for a pipelineStep decodes and applies
- **WHEN** a patch set carries `op: "create"`, `target: {kind: "pipelineStep", parentId: "<pipeline id>"}`,
  and a create patch naming a step type and config
- **THEN** the step is created under that pipeline

#### Scenario: A create edit naming a pipeline the caller cannot write is refused
- **WHEN** a `pipelineStep` create edit's `parentId` names a pipeline owned by another user
- **THEN** pre-validation refuses the whole patch set and nothing is created

#### Scenario: A create op for the output kind is still rejected
- **WHEN** a patch set carries `op: "create"` for `target.kind: "output"`
- **THEN** the patch set is rejected with a named error
