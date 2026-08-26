## ADDED Requirements

### Requirement: A committed workspace teardown writes exactly one audit event
A tag-scoped workspace teardown (`POST /api/workspace/teardown`) that **commits** — defined as the
underlying transaction actually running (no blocking conflict, `dryRun` false), regardless of
whether the tag matched zero, some, or all resources — SHALL write exactly one audit event with
action `workspace.teardown`, `resource_type` `workspace`, and `resource_id` set to the tag. The
event's `metadata` SHALL carry `sourcesDeleted`, `pipelinesDeleted`, and `typesDeleted` counts,
which MAY all be zero when the tag matched no resources.

#### Scenario: A committed teardown writes one audit row with deletion counts
- **WHEN** a workspace teardown for a tag with no conflicts is submitted with `dryRun` unset/false
- **THEN** exactly one audit event is written with action `workspace.teardown`, `resource_type`
  `workspace`, `resource_id` equal to the tag, and `metadata` carrying the actual
  `sourcesDeleted`/`pipelinesDeleted`/`typesDeleted` counts

#### Scenario: A committed teardown of a tag matching nothing still writes one audit row
- **WHEN** a workspace teardown is submitted for a tag that matches zero resources, with `dryRun`
  unset/false and no blocking conflict
- **THEN** exactly one audit event is written with action `workspace.teardown` and `metadata`
  carrying all three deletion counts as `0`

### Requirement: A dry-run or blocked teardown writes no audit row
Neither a `dryRun` teardown request nor a teardown that is blocked by a resource conflict (and
therefore deletes nothing) SHALL write a `workspace.teardown` audit event, since no destruction
occurred.

#### Scenario: A dry-run teardown writes no audit row
- **WHEN** a workspace teardown is submitted with `dryRun: true`
- **THEN** no `workspace.teardown` audit event is written

#### Scenario: A blocked teardown writes no audit row
- **WHEN** a workspace teardown for a tag with a shared/blocking resource is submitted and the
  repository reports the call as blocked
- **THEN** no `workspace.teardown` audit event is written
