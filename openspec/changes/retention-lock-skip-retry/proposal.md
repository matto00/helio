## Why

Since HEL-1333 the run-side payload trim holds the HEL1272 advisory key SHARED, so the hourly retention pass (which
takes it EXCLUSIVE with a try-lock) silently skips whenever any run is mid-trim. The skip returns `0` deleted — the
same as "nothing to do" — after the once-per-interval claim was already consumed, so a busy instance can go an hour
(or repeatedly longer) without thinning or purging history. Over-retention only, but unbounded on a busy instance.

## What Changes

- The history thin/purge and the node-payload purge report "lock not acquired" distinctly from "ran, deleted N".
- When either part of a retention pass is skipped because the lock is held, the next pass becomes due after a short
  retry window (default 2 minutes, env-configurable) instead of the full purge interval.
- A genuine failure (exception) still waits the full purge interval, as HEL-1272 requires.
- New tests: lock-held skip then success inside the retry window; failure still hourly; the real thin and age deletes
  (and payload purge) under the guard while a run holds the shared key, on the two-role topology.
- `CLAUDE.md` env table documents the new retry variable.

## Capabilities

### New Capabilities

### Modified Capabilities
- `output-history-retention`: adds the lock-held retry requirement and the retry-window env setting.
- `output-snapshot-history`: the repository's lock-held pass reports a distinct skip instead of returning 0.

## Impact

`OutputHistoryRetentionService`, `OutputHistoryRetentionConfig`, `OutputHistoryRepository.thinAndPurge`,
`NodePayloadHistoryRepository.purge` (return type), their existing test callers, `CLAUDE.md`. No migration, no API change.

## Non-goals

- Making retention win against continuous shared holders (blocking/queued exclusive lock) — see design.md.
- Rolling-deploy window where old instances keep the unguarded trim (self-resolving once replaced).
- Cross-instance claim coordination (still in-process, per HEL-1272).
