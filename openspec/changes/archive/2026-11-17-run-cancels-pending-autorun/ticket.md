# HEL-1739: A run that already read a dataset write should cancel that write's pending auto-run

## Description

origin_kind: followup
origin_ticket: HEL-1729 (PR matto00/helio#1138, merged as d95942e94)

Every successful dataset write schedules a downstream auto-run (`AutoRunTriggerService`, table
`pipeline_auto_run_debounce`, spec `openspec/specs/dataset-write-auto-run/spec.md:10-16`). The auto-run becomes due
`DATASET_WRITE_DEBOUNCE_SECONDS` after the write and fires on the next scheduler tick.

A manual or scheduled run that starts after the write has already read it. The pending auto-run still fires 5-30 s
later. That run is redundant and adds a duplicate history point; HEL-1729's flake was exactly this.

The owner ruled to change it (2026-11-17). This changes the `dataset-write-auto-run` spec.

**Behaviour:** when a real (non-dry) run of pipeline P starts, it cancels P's pending auto-run debounce rows for writes
made before the run started.

- A write that lands after the run started must still schedule its own auto-run.
- The HEL-505 guards are untouched: rate limit, concurrency cap and owner budget.
- HEL-1504's retry and re-arm behaviour is untouched.
- A run that fails after cancelling: decide in the design whether the cancelled auto-run comes back, and state it.

## Acceptance Criteria

- There is a backend test that fails first for each case: the cancel, a write during the run, and the failure path.
- The spec delta is updated.
- The HEL-1729 test-only workaround (`cancelPendingAutoRun` in `e2e/support/historySeed.ts`) is either removed or kept
  with its reason stated.
- Multi-instance safe: there is no per-instance state, the same as the existing debounce.

## Driver context (claims, verified at Planning)

- Flyway: use V144 if a migration is needed (V141-V143 reserved by sibling lanes); renumber to max+1 before merge if
  main moved past it. Migrating locally needs a lane-private DB (`createdb helio_hel1739`, DATABASE_URL override on
  start-servers.sh), dropped at Delivery.
- HEL-1734 (draft roots) extends draft/save "Save & run" and the lock protocol: keep any hook out of
  `PipelineRunService.submit` and the admission lock transaction where possible.
