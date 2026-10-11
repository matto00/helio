## Why

An editor grantee's real pipeline run executes and materializes Outputs, but writes no run history, leaves `last_run_*`
stale, and is never counted against HEL-505's concurrency cap — a resource-limit gap and a lying status badge (HEL-1492,
reproduced). The owner ruled it a bug and set the semantics (see ticket.md "Owner rulings").

## What Changes

- Editor-triggered real runs persist exactly like owner runs: `pipeline_runs` row (queued → terminal), assertion rows,
  `last_run_*`, run-history retention.
- Editor-triggered dry runs persist their `dry_run` row and assertions.
- The concurrency cap counts an editor's real run against the pipeline OWNER's budget (owner-keyed lock + count).
- New nullable `pipeline_runs.triggered_by_user_id` (migration V124), set on every new row to the submitting user.
- Editor writes go through existing privileged repository paths, after `submit`'s ACL check, re-verified in-transaction.
- CLAUDE.md env-table row for `PIPELINE_RUN_MAX_CONCURRENT` updated.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-run-guard`: the concurrency cap counts runs against the pipeline owner, whoever submitted them.
- `pipeline-run-execution`: editor-grantee runs are recorded and attributed like the owner's.
- `pipeline-assert-evaluation`: editor-grantee runs persist assertion results (was: silent no-op).

## Impact

Backend only: `PipelineRunExecutor`, `PipelineRunTerminalWrites`, `PipelineRunSucceededWrites`, `PipelineRunRepository`,
`PipelineRepository`, one Flyway migration, specs/tests, CLAUDE.md. No API/schema (`schemas/`) shape change, no frontend change,
no RLS policy change, no prod-data rewrite.

## Non-goals

- Exposing `triggered_by_user_id` in any API response or UI (a privacy decision of its own; follow-up).
- The HEL-462 schema-drift baseline write (`updateLastSourceSchema`), which is also owner-only for editor runs (follow-up).
- Changing the per-user rate limit (already keyed to the submitting user).
