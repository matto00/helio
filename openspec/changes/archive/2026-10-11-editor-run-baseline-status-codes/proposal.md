## Why

HEL-1492 made editor-grantee runs persist like the owner's, but left four gaps it filed as HEL-1503 (see ticket.md):
an editor's successful run never refreshes the HEL-462 schema-drift baseline; a pipeline deleted mid-submit answers
the owner with 403 and can answer an editor with 500; a revoked editor's dry run still executes and returns source rows;
and two spec texts are stale. Item 3 (repository split) is out of scope for this run; item 2 is an owner ruling only.

## What Changes

- An editor grantee's successful real run persists the schema-drift baseline exactly as the owner's run does, through
  the HEL-1492 privileged-after-ACL pattern; the baseline's source-schema input is resolved without the submitter's
  ownership filter so an editor's run never stores an empty baseline.
- Run admission distinguishes "the pipeline no longer exists" from "the submitter is no longer authorized"; a pipeline
  deleted mid-submit can no longer produce a 500. (Exact status codes: per the owner ruling recorded in ticket.md.)
- A dry run re-verifies owner-or-editor immediately before executing (per the owner ruling recorded in ticket.md).
- Spec text: the `pipeline-run-guard` concurrency requirement is renamed to name the owner's budget, its Purpose is
  corrected, and `pipeline-run-execution`'s TBD Purpose is written.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-schema-drift`: the baseline is persisted for an editor grantee's successful run, not only the owner's.
- `pipeline-run-execution`: mid-submit deletion and revoked-editor dry-run outcomes are specified.
- `pipeline-run-guard`: requirement renamed (owner's concurrency budget); no behaviour change.

## Impact

Backend only: `PipelineRunSucceededWrites`, `PipelineRunExecutor`, `PipelineRunRepository`, `PipelineRepository`,
specs and tests. No migration, no `schemas/` change, no frontend change, no RLS policy change.

## Non-goals

- Splitting `PipelineRunRepository.scala` (ticket item 3; stays on HEL-1503).
- Exposing `triggered_by_user_id` in any API or UI (ticket item 2; owner ruling recorded only).
- The baseline READ side: `findLastSourceSchema` is owner-scoped, so a grantee's analyze never reports drift (follow-up).
- HEL-1511's run reaper.
