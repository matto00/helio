## MODIFIED Requirements

### Requirement: Get pipeline schedule
The backend SHALL expose `GET /api/pipelines/:id/schedule` returning the schedule for the given pipeline if the caller
is the pipeline's owner or holds an `editor` or `viewer` grant on that pipeline (HEL-1837: read all, owner writes).
Access SHALL be decided by the same sharing-aware check the pipeline read routes use. The response SHALL carry the
same fields for every admitted caller and no owner or grantee identifier.

#### Scenario: Found and owned
- **WHEN** `GET /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has a schedule
- **THEN** the response is 200 with the full schedule

#### Scenario: Found for an editor or viewer grantee
- **WHEN** `GET /api/pipelines/:id/schedule` is called by an editor or viewer grantee of a pipeline that has a schedule
- **THEN** the response is 200 with the same schedule body the owner receives

#### Scenario: Owned pipeline with no schedule
- **WHEN** `GET /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has no schedule
- **THEN** the response is 404

#### Scenario: Shared pipeline with no schedule
- **WHEN** `GET /api/pipelines/:id/schedule` is called by an editor or viewer grantee of a pipeline that has no schedule
- **THEN** the response is 404

#### Scenario: Pipeline not found or not owned
- **WHEN** `GET /api/pipelines/:id/schedule` is called with an unknown `:id`, or for a pipeline owned by a different
  user on which the caller holds no grant
- **THEN** the response is 404 (existence not leaked)

### Requirement: Delete pipeline schedule
The backend SHALL expose `DELETE /api/pipelines/:id/schedule`, owner-scoped to the pipeline. An editor or viewer
grantee SHALL be refused with the same `404` the owner-only pipeline writes (rename, delete) give a grantee, and no
schedule is deleted.

#### Scenario: Successful delete
- **WHEN** `DELETE /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has a schedule
- **THEN** the response is 204 and the schedule no longer exists

#### Scenario: Delete when no schedule exists
- **WHEN** `DELETE /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has no schedule
- **THEN** the response is 404

#### Scenario: Pipeline not found or not owned
- **WHEN** `DELETE /api/pipelines/:id/schedule` is called with an unknown `:id`, or a pipeline
  owned by a different user
- **THEN** the response is 404 and no schedule is deleted

#### Scenario: Grantee delete refused
- **WHEN** an editor or viewer grantee calls `DELETE /api/pipelines/:id/schedule` on a pipeline that has a schedule
- **THEN** the response is 404 and the schedule still exists unchanged

## ADDED Requirements

### Requirement: Grantee schedule writes are refused
`PUT /api/pipelines/:id/schedule` SHALL stay owner-only (HEL-1837). An editor or viewer grantee SHALL receive the same
`404` the owner-only pipeline writes give a grantee, and no schedule is created or changed.

#### Scenario: Editor put refused
- **WHEN** an editor grantee calls `PUT /api/pipelines/:id/schedule` with a valid body
- **THEN** the response is 404 and the pipeline's schedule (or its absence) is unchanged

#### Scenario: Viewer put refused
- **WHEN** a viewer grantee calls `PUT /api/pipelines/:id/schedule` with a valid body
- **THEN** the response is 404 and the pipeline's schedule (or its absence) is unchanged
