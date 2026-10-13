## ADDED Requirements

### Requirement: Previews re-verify access immediately before executing

`GET /api/pipelines/:id/steps/:stepId/preview` and `POST /api/pipelines/:id/preview` SHALL, immediately before each
engine execution, re-verify that the caller still has the access the preview requires: the pipeline's owner or any
grantee (viewer or editor) for a closure containing no enabled AI step; the owner or an `editor` grantee for a closure
containing an enabled AI step. When the pipeline no longer exists the request SHALL return `404 Not Found`; when the
caller no longer has the required access it SHALL return `403 Forbidden`. In both cases the engine SHALL NOT execute.
A revocation that lands after this re-check is an accepted race. Previews that pass the re-check SHALL behave exactly
as before.

#### Scenario: A grant revoked mid-request refuses a step preview
- **WHEN** an editor grantee requests a step preview and the grant is deleted after the preview's access read but
  before execution
- **THEN** the response is `403 Forbidden` and the engine never executes

#### Scenario: A grant revoked mid-request refuses an output preview
- **WHEN** a grantee requests `POST /api/pipelines/:id/preview` and the grant is deleted after the access read but
  before execution
- **THEN** the response is `403 Forbidden` and the engine never executes

#### Scenario: A pipeline deleted mid-request answers 404
- **WHEN** the pipeline is deleted after the preview's access read but before execution
- **THEN** the response is `404 Not Found` and the engine never executes

#### Scenario: A viewer keeps a non-AI preview
- **WHEN** a viewer grantee with a live grant previews a step whose closure has no enabled AI step
- **THEN** the response is `200 OK` with the same rows as before this change
