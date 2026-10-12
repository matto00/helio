## ADDED Requirements

### Requirement: Duplicating a step applies create's reference checks to the clone
`POST /api/pipeline-steps/:id/duplicate` SHALL reject a clone whose configuration create would reject at the clone's
position for the lane-reference check and the upsert-target check: a lane reference that does not name an existing,
non-ancestor step of the pipeline, and an upsert target the pipeline owner cannot write, SHALL fail with the same
status and message create returns, and no step SHALL be stored.

#### Scenario: Duplicating a step whose lane reference was deleted is rejected
- **WHEN** a step with a lane reference to step L is duplicated after L was deleted
- **THEN** the request fails with the status and message create returns for a missing lane reference, and no step is stored

#### Scenario: Duplicating an upsert step whose target is no longer writable is rejected
- **WHEN** an `upsert_source` step is duplicated after its target source was deleted or is no longer a writable dataset
- **THEN** the request fails with the status and message create returns for that target, and no step is stored

### Requirement: Duplicating a step applies create's secondary-source ownership check to the caller
`POST /api/pipeline-steps/:id/duplicate` SHALL reject, with the same 404 create returns, a clone of a `join`, `union`
or `lookup` step whose configured secondary data source the calling user does not own, before any other reference
check; no step SHALL be stored. A step whose secondary source id is unset (an incomplete draft) or whose secondary
input is a lane SHALL remain duplicable as before.

#### Scenario: Editor cannot duplicate a join on a source they do not own
- **WHEN** an editor grantee duplicates a `join` step whose secondary data source is owned only by the pipeline owner
- **THEN** the request fails with 404 `Data source not found`, as create does for that config, and no step is stored

#### Scenario: Union and lookup are covered the same way
- **WHEN** an editor grantee duplicates a `union` or `lookup` step whose secondary data source they do not own
- **THEN** the request fails with 404 and no step is stored

#### Scenario: The owner can still duplicate the step
- **WHEN** the pipeline owner, who owns that secondary data source, duplicates the same step
- **THEN** the clone is created directly after the original
