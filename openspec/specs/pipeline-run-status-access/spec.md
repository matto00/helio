# pipeline-run-status-access Specification

## Purpose
Defines who may read a pipeline run's status and result rows through `GET /api/pipelines/:id/runs/:runId`, and that a missing, foreign, or mis-scoped run is indistinguishable to the caller.

## Requirements

### Requirement: Run status is scoped to the path pipeline and the caller's visibility
`GET /api/pipelines/:id/runs/:runId` SHALL return a run's status, rows and error only when the caller can see the pipeline `:id` (owner or an editor/viewer grantee) AND the run was recorded against that same pipeline.

#### Scenario: Owner reads a run of their pipeline
- **WHEN** the owner requests a run recorded against their pipeline
- **THEN** the response is 200 with the run's status and rows

#### Scenario: Grantee reads a run of a shared pipeline
- **WHEN** a viewer grantee of the pipeline requests one of its runs
- **THEN** the response is 200

#### Scenario: Stranger requests a foreign run
- **WHEN** a caller with no access to the pipeline requests a real run id under that pipeline id
- **THEN** the response is 404 and no run data is returned

#### Scenario: Run id from a different pipeline
- **WHEN** the caller requests, under a pipeline they can see, a run id recorded against a different pipeline
- **THEN** the response is 404 and no run data is returned

### Requirement: Foreign, absent and mis-scoped runs are indistinguishable
The 404 for a pipeline the caller cannot see, a nonexistent pipeline, a nonexistent run, and a run belonging to another pipeline SHALL be byte-identical in status, content type and serialized body, and SHALL NOT echo the caller-supplied run id.

#### Scenario: Foreign and nonexistent compare equal
- **WHEN** a stranger requests a real foreign run id and, separately, a random nonexistent run id
- **THEN** both responses have the same status, content type and body
