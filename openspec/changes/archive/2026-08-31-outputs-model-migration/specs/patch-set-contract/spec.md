## MODIFIED Requirements

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
