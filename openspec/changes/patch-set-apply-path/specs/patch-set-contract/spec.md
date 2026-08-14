## MODIFIED Requirements

### Requirement: patch reuses existing per-resource request shapes
An `Edit`'s `patch` field SHALL NOT introduce new per-resource shapes. Its real shape, documented
per `(target.kind, op)` in the schema's own description rather than machine-`$ref`'d (none of the
six per-resource request shapes has an existing standalone schema file), SHALL be: for `op:
update`, the existing `UpdatePanelRequest`/`UpdateDashboardRequest`/`UpdateDataSourceRequest`/
`UpdateDataTypeRequest`/`UpdatePipelineRequest`/`UpdatePipelineStepRequest` shape matching
`target.kind`; for `op: create`, the matching `Create*Request` shape (decoded by a future apply
path, not this contract); for `op: delete`, `patch` is unused — the backend `Edit` reader SHALL
raise a `deserializationError` when `op` is `delete` and the wire JSON's `"patch"` key is present,
rather than silently discarding it.

#### Scenario: An update edit's patch matches the target kind's existing PATCH shape
- **WHEN** an `Edit` has `target.kind: "dashboard"`, `op: "update"`, and `patch: {name: "Renamed"}`
- **THEN** the backend `PatchSetProtocol` decodes `patch` into the existing `UpdateDashboardRequest`
  case class — the same type `PATCH /api/dashboards/:id` already decodes

#### Scenario: A delete edit with a populated patch is rejected, not silently dropped
- **WHEN** an `Edit`'s wire JSON has `op: "delete"` and a non-empty `patch` object
- **THEN** the backend `Edit` reader raises a `deserializationError` rather than constructing an
  `Edit` with the `patch` value silently discarded
