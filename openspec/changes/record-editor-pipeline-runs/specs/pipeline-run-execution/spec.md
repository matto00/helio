## ADDED Requirements

### Requirement: Runs triggered by an editor grantee are recorded and attributed like the owner's
A real or dry run submitted by an editor grantee of a pipeline SHALL produce the same persisted run record, assertion
results, run-history retention and (for real runs) `last_run_status`/`last_run_at`/`last_run_row_count`/
`last_run_truncated` updates as the same run submitted by the pipeline's owner. Every `pipeline_runs` row created by a run
submission SHALL record the submitting user's id as `triggered_by_user_id`; rows created before this requirement keep a null
value. A run SHALL be admitted (and its run row written) only for a submitter who is the pipeline's owner or holds an editor
grant on it, verified in the same transaction as the run-row insert; a viewer grantee's or non-grantee's submission SHALL
write nothing. Once a run is admitted, its lifecycle-completion writes (terminal status, assertion results, `last_run_*`,
retention) SHALL always complete, even if the grant is revoked mid-run, so no admitted run is left non-terminal.

#### Scenario: An editor grantee's successful real run is recorded
- **WHEN** an editor grantee runs a pipeline they do not own (non-dry) and execution succeeds
- **THEN** a `pipeline_runs` row exists for that pipeline with `status = "succeeded"`, `row_count` set and
  `triggered_by_user_id` equal to the editor's id, its assertion results are stored, and the pipeline's `last_run_status` is
  `"succeeded"` with `last_run_at` set

#### Scenario: An editor grantee's failed real run is recorded
- **WHEN** an editor grantee's non-dry run fails, is blocked by an error-severity assertion, or its deferred `upsertsource`
  write-back fails (reported as a failure or raised as an exception)
- **THEN** a `pipeline_runs` row exists with `status = "failed"` and an `error_log`, and the pipeline's `last_run_status` is `"failed"`

#### Scenario: An editor grantee's dry run is recorded
- **WHEN** an editor grantee dry-runs a pipeline they do not own and execution succeeds
- **THEN** a `pipeline_runs` row exists with `status = "dry_run"` and `triggered_by_user_id` equal to the editor's id, and the
  pipeline's `last_run_status`/`last_run_at` are unchanged

#### Scenario: The owner's runs record the owner as the trigger
- **WHEN** the pipeline's owner runs it (manually, by schedule, or by hook)
- **THEN** the new `pipeline_runs` row's `triggered_by_user_id` equals the owner's id

#### Scenario: A viewer grantee's run writes nothing
- **WHEN** a viewer grantee submits a real or dry run
- **THEN** the response is `403 Forbidden` and no `pipeline_runs` or assertion row is written and `last_run_*` is unchanged

#### Scenario: A grant revoked before admission prevents the run
- **WHEN** an editor grantee's grant is revoked after the submission's access check but before the run row is written
- **THEN** the submission is refused with `403 Forbidden`, the pipeline is never executed, and nothing is written
