# patch-set-contract Specification

## Purpose
Defines the patch-set schema + backend protocol — a reviewable artifact describing N targeted
edits (update/delete/create) across one or more existing resources, reusing existing per-resource
PATCH/create request shapes — the foundation the conversational-refinement diff-preview,
atomic-apply, and undo work builds on.

## Requirements

### Requirement: PatchSet schema shape
`schemas/patch-sets/patch-set.schema.json` SHALL define a `PatchSet` object requiring `edits` (an ordered
array of `Edit`) and carrying an optional `summary` string. Each `Edit` SHALL require `target`
(an object with a required `kind`, one of `panel`/`dashboard`/`dataSource`/`dataType`/`pipeline`/
`pipelineStep`, and an optional `id`) and `op` (one of `update`/`delete`/`create`), plus an
optional `patch` object.

#### Scenario: A minimal valid patch set validates
- **WHEN** a JSON document supplies `edits` as a single-element array with a `target` of
  `{kind: "panel", id: "panel-1"}` and `op: "delete"`
- **THEN** the document validates against `schemas/patch-sets/patch-set.schema.json`

#### Scenario: A patch set missing `edits` is rejected
- **WHEN** a JSON document supplies only `summary`, omitting `edits`
- **THEN** the document fails validation against `schemas/patch-sets/patch-set.schema.json`

### Requirement: target.id is required for update/delete, optional for create
The schema SHALL require `target.id` whenever an `Edit`'s `op` is `update` or `delete`, and SHALL
NOT require it when `op` is `create` — expressed via a conditional (`if`/`then`) constraint,
mirroring the existing discriminated-shape pattern in `create-panel-request.schema.json`.

#### Scenario: An update edit without target.id is rejected
- **WHEN** an `Edit` has `op: "update"` and a `target` omitting `id`
- **THEN** the document fails validation against `schemas/patch-sets/patch-set.schema.json`

#### Scenario: A create edit without target.id validates
- **WHEN** an `Edit` has `op: "create"` and a `target` omitting `id`
- **THEN** the document validates against `schemas/patch-sets/patch-set.schema.json`

### Requirement: patch reuses existing per-resource request shapes
A patch's `target.kind` SHALL be one of the surviving resource kinds (`dashboard`, `panel`,
`pipeline`, `pipelineStep`, `output`, `dataSource`); `dataType` and `metric` are no longer valid
target kinds. Existing persisted patch-set journal entries targeting `dataType` or `metric` are
deleted by the outputs-model migration.

#### Scenario: A dataType or metric target kind is rejected
- **WHEN** a patch is submitted with `target.kind = "dataType"` or `target.kind = "metric"`
- **THEN** the request is rejected as an invalid target kind

#### Scenario: An output target kind is accepted
- **WHEN** a patch is submitted with `target.kind = "output"` and a valid per-resource shape
- **THEN** the patch is accepted and applies to the named Output

#### Scenario: An update edit's patch matches the target kind's existing PATCH shape
- **WHEN** an `Edit` has `target.kind: "dashboard"`, `op: "update"`, and `patch: {name: "Renamed"}`
- **THEN** the backend `PatchSetProtocol` decodes `patch` into the existing `UpdateDashboardRequest`
  case class — the same type `PATCH /api/dashboards/:id` already decodes

#### Scenario: A delete edit with a populated patch is rejected, not silently dropped
- **WHEN** an `Edit`'s wire JSON has `op: "delete"` and a non-empty `patch` object
- **THEN** the backend `Edit` reader raises a `deserializationError` rather than constructing an
  `Edit` with the `patch` value silently discarded

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
