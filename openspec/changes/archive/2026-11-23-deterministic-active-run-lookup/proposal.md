## Why

`PipelineRunRepository.findActiveRunInternal` picks "the" open run (`completed_at IS NULL`) of a pipeline with no
ORDER BY, and its doc comment claims at most one run can be open. That is false: manual submits (a second tab, an
editor grantee, a PAT/API call, helio-mcp `run_pipeline`) have no per-pipeline overlap check, so a duplicate
`POST /api/hooks/run` can be collapsed into either open run, at random. The owner ruled (HEL-1833 escalation,
`keep-overlap-determinism-only`) that overlapping manual runs stay allowed; only the lookup must be deterministic.

## What Changes

- `findActiveRunInternal` orders open runs by `started_at DESC, id DESC` and returns the first (the newest open run),
  the same order HEL-1626 gave every latest-run read. `id DESC` makes it deterministic; it does not mean "more recent".
- Its stale "at most one open run" doc comment is corrected to say several open runs can exist and which one is
  returned.
- A red-first spec seeds two (and three) open runs of one pipeline in both insertion orders, with tied and distinct
  `started_at`, and asserts the same run every time; the dropped-ORDER-BY mutation is recorded.

## Non-goals

- No refuse (409) or coalesce rule for a second manual run; overlapping open manual runs remain allowed (owner ruling).
- No change to `hasActiveRunInternal`, the scheduler or auto-run guards, the HEL-505 cap, or the frontend Run button.
- No migration unless EXPLAIN shows the lookup needs an index (none expected).

## Capabilities

### New Capabilities

### Modified Capabilities
- `external-run-hooks`: the duplicate-trigger collapse names which in-flight run is returned when several are open.

## Impact

- `backend/.../persistence/pipelines/PipelineRunRepository.scala` (`findActiveRunInternal` and its doc comment).
- New backend test spec for the lookup; `HookTriggerService` behaviour changes only in which open run it reports.
- No API shape, schema, frontend or migration change.
