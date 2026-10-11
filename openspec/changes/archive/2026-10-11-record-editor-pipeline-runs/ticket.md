# HEL-1492: Non-owner editor pipeline runs write no run row, skip last_run_*, and bypass the HEL-505 concurrency cap

## Description

origin_kind: followup / origin_ticket: HEL-1488. Found by HEL-1488's evaluator while pinning `PipelineRunService.submit`.

An editor grantee who is not the pipeline owner can trigger a real run (correct — editors are authorized), but persistence
is owner-only: `PipelineRunRepository.insertRun`, `updateRunTerminal`, `insertDryRun` and `PipelineRepository.updateLastRun`
are no-ops unless the caller owns the pipeline, and `PipelineRunExecutor` treats the HEL-505 `NotOwned` result as admitted.

Consequences when an editor runs a pipeline:
1. No `pipeline_runs` history row (and no assertion results) is written; a dry run writes no `dry_run` row either.
2. The pipeline's `last_run_*` status/badge is not updated.
3. The run is not counted against HEL-505's `PIPELINE_RUN_MAX_CONCURRENT` cap (it counts non-terminal `pipeline_runs` rows).
   The per-user rate limit still applies. Outputs are still materialized.

Reproduced 2026-10-11 as a non-superuser NOBYPASSRLS role (evidence `.concertino/runs/HEL-1492/evidence/repro.md`).
Root cause is the deliberate app-layer owner filter; RLS (V35 `pipeline_runs_owner`, V39 `pipelines_update`) would also
block these writes under the editor's own context (INSERT 42501, UPDATE 0 rows). No cross-tenant leak found.

## Owner rulings (2026-10-11, escalation answered)

- Q1: bug — fix now.
- Q2: an editor's real run counts against the PIPELINE OWNER's concurrency budget.
- Q3: editor runs appear in run history (with assertions) and update `last_run_*`, attributed to the triggering user via a
  new nullable `pipeline_runs.triggered_by_user_id` column (additive migration, no backfill, no prod-data change).
- Q4: an editor dry run writes its `dry_run` row like the owner's.
- Q5: write path = privileged (`*Internal`/system-context) writes, reached only after `submit`'s owner-or-editor ACL check;
  RLS policies unchanged.

## Acceptance Criteria

- An editor grantee's successful real run writes a `pipeline_runs` row (queued → succeeded) with `row_count`, its assertion
  rows, and updates the pipeline's `last_run_status`/`last_run_at`/`last_run_row_count`/`last_run_truncated`.
- An editor's failed real run, assertion-blocked run, and write-back-failed run (both the `Left` and the exception path) reach
  terminal `failed` in `pipeline_runs` and `last_run_*`, exactly as
  an owner's do.
- An editor's real run is counted against the pipeline owner's `PIPELINE_RUN_MAX_CONCURRENT` budget: with the owner at the cap,
  an editor's real submit on that owner's pipeline is rejected 429 with `Retry-After` and never executes; an in-flight editor run
  occupies one of the owner's slots.
- An editor's successful dry run writes a `dry_run` row (and its assertions) and does not touch `last_run_*` or the cap.
- Every newly written `pipeline_runs` row records `triggered_by_user_id` = the submitting user's id (owner, editor, scheduler's
  synthetic owner, hook token user); existing rows stay NULL. Run-history retention (keep 10) applies to editor runs.
- Viewer grantees still get 403 with no writes; non-grantees still 404. RLS policies are unchanged. A run is admitted only
  for a submitter who is the owner or an editor, re-verified in the same transaction as the run-row insert; once admitted,
  the run's lifecycle-completion writes (terminal status, assertions, last_run_*, retention) always complete, so an admitted
  run can never stay non-terminal and hold one of the owner's concurrency slots.
- Owner-run behaviour is otherwise unchanged. Tests are red-first, use `VerifiedEmbeddedPostgres.start`, and assert persistence
  as a non-superuser NOBYPASSRLS role. CLAUDE.md's `PIPELINE_RUN_MAX_CONCURRENT` row states the owner-budget semantics.
