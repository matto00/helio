## Why

The history delta API (HEL-1273) resolves a window baseline as the newest point at or before `latest − w` (owner ruling
D6), but no test places a point exactly on that boundary through the window path. A `<=` → `<` regression in the
nearest-at-or-before query would silently move every boundary baseline one point older.

## What Changes

- A repository-level test in `OutputHistoryRepositorySpec`: points at `latest − w − 1µs`, exactly `latest − w`, and
  `latest`; `nearestAtOrBefore(latest − w)` must return the exact-boundary point.
- A route-level test in `OutputHistoryRoutesSpec`: a `compare: "7d"` metric Output whose baseline point sits exactly
  at `T − 7d` (with a decoy 1µs earlier); `GET /api/outputs/:id/history` must return it as `baseline`, with
  `delta`/`pct` computed against it.
- Both instants are microsecond-exact, and the tests assert the stored instants round-trip unchanged.
- Recorded evidence: both tests red under the `<=` → `<` mutation, then green with the mutation reverted.
- An added spec scenario that pins the boundary in the `output-history-api` contract.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `output-history-api`: the Comparison resolution requirement gains an explicit scenario for a point exactly at
  `current − w`. The requirement text is unchanged.

## Impact

Test code only (`backend/src/test/...`) plus the spec scenario. There is no production code change, because
`nearestAtOrBefore` already uses `<=`. If the new tests show otherwise, a minimal fix to that one predicate is in scope.

## Non-goals

- The public dashboard history variant: it shares `OutputHistoryService` and gets no extra test here.
- Changing D6, thinning semantics (HEL-1285), or anything in `NodeSnapshotRepository` / history schemas (HEL-1326).
- Removing or rewriting the existing repo-level `exactly-at` assertion (`OutputHistoryRepositorySpec`).
