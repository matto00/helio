## ADDED Requirements

### Requirement: A run submission for a pipeline deleted mid-submit is refused as not found
When a pipeline is deleted after a run submission's access check but before the run is admitted, the system SHALL
refuse the submission with `404 Not Found`, SHALL NOT execute the pipeline, and SHALL write no run record — for the
pipeline's owner and for an editor grantee alike, real or dry. Such a submission SHALL never be answered with a server
error. `403 Forbidden` SHALL remain the response only when the pipeline still exists and the submitter is no longer its
owner or an editor grantee.

#### Scenario: The owner's submission for a pipeline deleted mid-submit
- **WHEN** the pipeline's owner submits a real run and the pipeline is deleted after the access check but before admission
- **THEN** the response is `404 Not Found`, the pipeline is never executed, and no `pipeline_runs` row exists for it

#### Scenario: An editor grantee's submission for a pipeline deleted mid-submit
- **WHEN** an editor grantee submits a real run and the pipeline is deleted after the access check but before admission
- **THEN** the response is `404 Not Found` (never `500`), and the pipeline is never executed

#### Scenario: A deletion that races an admission never fails the admission with a server error
- **WHEN** a pipeline deletion commits concurrently with a run submission's admission
- **THEN** the admission either refuses the submission with `404 Not Found`, or admits the run (whose run record is later
  removed with the pipeline); the admission step itself never fails with a `5xx` status

### Requirement: A dry run re-verifies the submitter before executing
Immediately before executing a dry run, the system SHALL re-verify that the submitter is still the pipeline's owner or
holds an editor grant on it. A submitter whose editor grant was revoked after the submission's access check SHALL be
refused with `403 Forbidden`; the pipeline SHALL NOT be executed and no rows SHALL be returned or written. A revoke that
lands after this re-verification is an accepted race, as for real runs.

#### Scenario: A revoked editor's dry run is refused
- **WHEN** an editor grantee submits a dry run and their grant is revoked after the access check but before execution
- **THEN** the response is `403 Forbidden`, the pipeline is never executed, and no `pipeline_runs` row is written

#### Scenario: An editor grantee's dry run with a live grant is unaffected
- **WHEN** an editor grantee with a live grant submits a dry run
- **THEN** it executes and returns preview rows, and a `dry_run` row attributed to the editor is written
