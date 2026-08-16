# external-run-hooks Specification

## Purpose
A documented, authenticated, idempotent-friendly `POST /api/hooks/run` entrypoint that lets an
external scheduler (cron, systemd, Cloud Scheduler) or automation launch a pipeline rebuild, backed
by scoped Personal Access Tokens for least-privilege recurring workflows.
## Requirements
### Requirement: External trigger endpoint launches a pipeline run
The system SHALL expose `POST /api/hooks/run` accepting `{ "pipelineId": "<id>" }`, authenticated by
session cookie or `Authorization: Bearer helio_pat_...` (per the `request-authentication`
capability). On success it SHALL launch the pipeline run via the same run-lifecycle path as
`POST /api/pipelines/:id/run` (recorded with `trigger_source = "external"`) and SHALL return
`200 OK` with `{ runId, pipelineId, status }`, where `status` SHALL be `"failed"` — not `"succeeded"` —
when the run completes execution without exception but is blocked by an error-severity assertion
failure (see `pipeline-assert-fail-policy`), exactly mirroring the status that terminal run record
itself carries; no rollback is performed for this endpoint, since a hook-triggered run is always a
re-run of an already-existing pipeline, so the prior DataType snapshot (never touched by a blocked run)
remains the correct, current one.

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
- **THEN** the system returns `200 OK` with `status: "failed"` (not `"succeeded"`), and the pipeline's
  previously-persisted DataType snapshot is unchanged

### Requirement: Scoped tokens are confined to the hook endpoint and their pipeline allow-list
A PAT minted with a non-null `scopedPipelineIds` allow-list SHALL authenticate ONLY
`POST /api/hooks/run`; every other authenticated route SHALL reject it with `403 Forbidden`. Within
`POST /api/hooks/run`, a scoped token SHALL be rejected with `403 Forbidden` if the requested
`pipelineId` is not a member of its allow-list.

#### Scenario: Scoped token rejected on an unrelated route
- **WHEN** a request to `GET /api/dashboards` carries a PAT with a non-null `scopedPipelineIds`
- **THEN** the system returns `403 Forbidden`

#### Scenario: Scoped token rejected on the public/optional-auth dashboard-read route
- **WHEN** a request to `GET /api/dashboards/:id/panels` (the optional-auth route that also accepts
  `Authorization: Bearer` credentials for owner/sharing checks) carries a PAT with a non-null
  `scopedPipelineIds`, targeting a dashboard the token's underlying user legitimately owns
- **THEN** the system returns `403 Forbidden` — the token MUST NOT resolve to full owner-level
  dashboard access on this route family, even though it authenticates successfully as that user's
  identity

#### Scenario: Scoped token used outside its pipeline allow-list
- **WHEN** `POST /api/hooks/run` is called with `{ "pipelineId": "<other-id>" }` and a PAT whose
  `scopedPipelineIds` does not include `<other-id>`
- **THEN** the system returns `403 Forbidden`

### Requirement: Duplicate external triggers collapse into the in-flight run
The system SHALL NOT start a second run when `POST /api/hooks/run` is called for a pipeline that
already has an in-flight (not yet completed) run; it SHALL instead return `200 OK` with the
in-flight run's `runId` and its current status.

#### Scenario: Retry while a triggered run is still executing
- **WHEN** `POST /api/hooks/run` is called for a pipeline that already has an incomplete run
- **THEN** the system returns `200 OK` with the existing run's `runId` rather than inserting a new
  `pipeline_runs` row

### Requirement: External triggers are recorded for audit
Every run started by `POST /api/hooks/run` SHALL be recorded with the existing `trigger_source`,
`started_at`, `pipeline_id`, and terminal `status`/`error_log`, and SHALL be readable via
`GET /api/pipelines/:id/run-history`. When the request was authenticated by a **scoped** token, the
run record SHALL additionally carry that token's id. An unscoped-PAT-authenticated or
session-authenticated trigger is still attributable to the resolved user (the pipeline owner
context under which run-history is already scoped), but does not carry a per-token id — only
scoped tokens need per-request confinement/audit data, so only they are threaded through.

#### Scenario: Run history exposes the triggering token for a scoped-token trigger
- **WHEN** a pipeline is triggered via `POST /api/hooks/run` using a scoped token, then
  `GET /api/pipelines/:id/run-history` is called by the pipeline owner
- **THEN** the matching run record includes the token's id

#### Scenario: Run history omits a token id for an unscoped-PAT trigger
- **WHEN** a pipeline is triggered via `POST /api/hooks/run` using an unscoped PAT, then
  `GET /api/pipelines/:id/run-history` is called by the pipeline owner
- **THEN** the matching run record has `triggerSource: "external"` and no token id

