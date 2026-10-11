## REMOVED Requirements

### Requirement: Persisting assertion results never turns a silent no-op run into an unhandled failure
**Reason**: HEL-1492 — an editor grantee's run no longer silently no-ops its run-row insert; it persists its run row and
assertion results like the owner's, so the requirement's premise (and its two editor scenarios) is now false.
**Migration**: Replaced by "Persisting assertion results never turns a missing run row into an unhandled failure" below.

## ADDED Requirements

### Requirement: Persisting assertion results never turns a missing run row into an unhandled failure
The `insertAssertions` call SHALL NOT raise or propagate a failure when no `pipeline_runs` row exists for it to reference
(for example a failed dry run, or an editor's dry run whose grant was revoked before its run row was written) — the run
SHALL resolve with the same response shape it would have produced otherwise, real or dry. A run triggered by an editor
grantee (not the pipeline owner) SHALL persist its run row and its assertion results exactly as the owner's run does (see
`pipeline-run-execution`).

#### Scenario: Editor-grantee-triggered real run persists its assertion results
- **WHEN** an editor grantee (not the pipeline owner) triggers a real run on a pipeline containing an
  `assert` step, via the ordinary run-submission path
- **THEN** the run resolves normally, a `pipeline_runs` row exists for it, and its `pipeline_run_assertions` rows are
  linked to that row

#### Scenario: Editor-grantee-triggered dry run persists its assertion results
- **WHEN** an editor grantee (not the pipeline owner) triggers a dry run on a pipeline containing an
  `assert` step, via the ordinary run-submission path, and it succeeds
- **THEN** the dry run resolves normally, a `pipeline_runs` row with `status = "dry_run"` exists for it, and its
  `pipeline_run_assertions` rows are linked to that row

#### Scenario: A run with no run row still resolves normally
- **WHEN** an editor grantee's dry run has its grant revoked before its run row is written, so no `pipeline_runs` row exists
- **THEN** the dry run resolves normally and no unhandled failure is raised by assertion persistence
