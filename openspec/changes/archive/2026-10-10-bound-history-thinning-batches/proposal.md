## Why

HEL-1284 measured the Output-history thin DELETE as 95–99.9% of the retention tick: one statement that ranks every row
of `output_snapshot_history` twice, spills ~600 MB to temp at 5M rows, and turns a thinning backlog into one unbounded
transaction (a year of backlog extrapolates to ~20 GB temp on a 10 GB prod disk). Production speed was only assumed.

## What Changes

- The thin runs as a sequence of short statements, each over a bounded batch of Outputs (keyset over `outputs.id`),
  each in its own transaction under the existing try-only retention advisory lock, ranking each row once.
- A retention pass has a bounded budget of thin batches; a pass that exhausts it leaves the rest for the next scheduler
  tick (continuation), so a backlog drains over several ticks and no transaction grows with table size.
- The tier age purge runs per batch (same cutoffs, restricted to the batch's Outputs) before that batch's thin.
- Two env vars size the batch and the per-pass budget (defaults chosen from measurement, documented in CLAUDE.md).
- Measurements on real PostgreSQL 16 in a local resource-limited container (prod-class proxy, justified), before/after
  plans, timings, temp usage; a row-by-row survivor diff old vs new; raw logs for every run, including HEL-1284's
  missing insert-path and index-build raw logs; a note that the payload "unreferenced" DELETE cannot be index-bounded.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `output-history-retention`: thinning executes in bounded batches; a pass that exhausts its batch budget continues on
  the next scheduler tick instead of waiting the purge interval; new batch-size/budget configuration.

## Non-goals

- No change to which points survive: bucket widths, age classes, tier caps, newest-101 protection, ordering, lock key,
  lock-retry window, payload retention all stay identical.
- No migration expected; no cadence change for a pass that completes; no prod or cloud access.

## Impact

`OutputHistoryRepository.thinAndPurge`, `OutputHistoryRetentionService`, `OutputHistoryRetentionConfig`, `Main`
wiring, retention specs/tests, `backend/scripts/perf/`, CLAUDE.md env table.
