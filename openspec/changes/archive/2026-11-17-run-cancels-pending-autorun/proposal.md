## Why

A dataset write arms a debounced auto-run of every eligible downstream pipeline (HEL-1093). When a manual, scheduled,
hook or other real run of that pipeline starts after the write, it already reads the written rows, yet the armed
auto-run still fires 5-30 s later: a redundant run and a duplicate Output history point. HEL-1729's e2e flake was this,
worked around test-side with `cancelPendingAutoRun`. The owner ruled (2026-11-17) that the product should stop doing
it.

## What Changes

- A debounce row gains a globally unique write generation (V144, with an explicit sequence grant to
  `helio_privileged`), bumped by every dataset write's upsert.
- A real (non-dry) run snapshots its pipeline's pending debounce generation immediately before admission, so before
  it reads any source rows. When that run's terminal `succeeded` write wins, it deletes the debounce row only if its generation is
  still the snapshotted one (compare-and-delete). A write that landed after the snapshot bumped the generation, so its
  auto-run survives.
- A run that fails (including blocked, write-back failure, or reaped as abandoned) cancels nothing: the write's
  auto-run fires exactly as it did before this change.
- The e2e workaround `cancelPendingAutoRun` and its three call sites are removed: the spec's own synchronous manual
  runs now cancel the rows its writes armed.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `dataset-write-auto-run`: adds the requirement that a successful real run cancels the pending auto-run of every
  write it read, and only those writes; narrows the HEL-1504 requirement "An auto-run that finds the pipeline already
  running fires after that run completes" with a carve-out for that cancel.

## Impact

- `PipelineAutoRunDebounceRepository` (generation column in upsert, snapshot read, compare-and-delete), V144 migration.
- `PipelineRunExecutor` (snapshot after admission) and the `succeeded` terminal-win path in
  `PipelineRunSucceededWrites`. `PipelineRunService.submit` and the admission lock transaction are not touched.
- `e2e/support/historySeed.ts`, `e2e/hel1277-output-history-scrubber.spec.ts`.

## Non-goals

- Changing the HEL-505 guards (rate limit, concurrency cap, owner budget) or HEL-1504's firer mechanics (unclaim /
  re-arm / drop). The HEL-1504 in-flight requirement's outcome does change for writes a successful run read.
- Closing the pre-existing firer race (`hasActiveRunInternal` read then `submit`), which this change neither widens nor
  relies on.
- Dry runs, previews and draft-preview: they never cancel anything.
