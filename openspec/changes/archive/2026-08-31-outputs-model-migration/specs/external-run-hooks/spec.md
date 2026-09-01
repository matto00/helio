## MODIFIED Requirements

### Requirement: External trigger endpoint launches a pipeline run
The system SHALL expose `POST /api/hooks/run` accepting `{ "pipelineId": "<id>" }`, authenticated by
session cookie or `Authorization: Bearer helio_pat_...` (per the `request-authentication`
capability). On success it SHALL launch the pipeline run via the same run-lifecycle path as
`POST /api/pipelines/:id/run` (recorded with `trigger_source = "external"`) and SHALL return
`200 OK` with `{ runId, pipelineId, status }`, where `status` SHALL be `"failed"` — not `"succeeded"` —
when the run completes execution without exception but is blocked by an error-severity assertion
failure (see `pipeline-assert-fail-policy`), exactly mirroring the status that terminal run record
itself carries; no rollback is performed for this endpoint, since a hook-triggered run is always a
re-run of an already-existing pipeline, so the prior node snapshot(s) (never touched by a blocked
run) remain the correct, current ones.

#### Scenario: Valid unscoped PAT triggers a run
- **WHEN** `POST /api/hooks/run` is called with `{ "pipelineId": "<owned-pipeline-id>" }` and a
  valid, unscoped `helio_pat_...` bearer token owned by the pipeline's owner
- **THEN** the system returns `200 OK` with a `runId`, and the run appears in
  `GET /api/pipelines/:id/run-history` with `triggerSource: "external"`

#### Scenario: Valid scoped PAT triggers an in-scope pipeline
- **WHEN** `POST /api/hooks/run` is called with `{ "pipelineId": "<id>" }` and a PAT whose
  `scopedPipelineIds` includes `<id>`
- **THEN** the system returns `200 OK` with a `runId`

#### Scenario: Pipeline the caller cannot access
- **WHEN** `POST /api/hooks/run` is called with a `pipelineId` the authenticated user neither owns
  nor has editor access to
- **THEN** the system returns `404 Not Found` (pipeline-level ACL, unrelated to token scope)

#### Scenario: Missing or invalid credential
- **WHEN** `POST /api/hooks/run` is called with no credential, or an invalid/expired/revoked one
- **THEN** the system returns `401 Unauthorized`

#### Scenario: A run blocked by an error-severity assertion reports status failed, not succeeded
- **WHEN** `POST /api/hooks/run` is called for a pipeline whose `assert` step has an error-severity
  rule that fails
- **THEN** the system returns `200 OK` with `status: "failed"` (not `"succeeded"`), and every
  materialized node's previously-persisted snapshot is unchanged
