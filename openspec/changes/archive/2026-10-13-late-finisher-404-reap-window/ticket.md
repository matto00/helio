# HEL-1518: After HEL-1511: late finisher after pipeline delete gets 409 (should be 404); close the reap-vs-snapshot-write window; privileged-call comments

## Description

These follow-ups came from HEL-1511 (matto00/helio#973, 621640292). It added V126 `heartbeat_at`, a 30 s heartbeat timer, and a stale-run reaper on each tick (`PIPELINE_RUN_STALE_AFTER_SECONDS`, default 600; null-heartbeat runs over 1 h are reaped). The first terminal write wins.

1. If a pipeline is deleted after its run is admitted, the cascade deletes the run row, and a late finisher answers 409 with a "reaped" message where 404 fits.
2. A run reaped between the "still open?" check and the snapshot writes can still write snapshots. That needs a heartbeat already more than 600 s old, and it's covered by the Q6 ruling. Close it by moving the check into the snapshot-write transaction.
3. The new `reapStaleRunsInternal` and `isRunOpenInternal` call sites lack the comment DbContext asks for at privileged call sites, explaining why bypassing row-level security is correct there.

**Ops note for v0.9.4:** run the read-only count query in the PR matto00/helio#973 body against prod before release; the first deploy marks stuck runs failed. After deploy, helio-news can drop its 45 s wait-and-rerun workaround.

## Acceptance Criteria

Derived from the description's three numbered items (the ticket has no separate AC list):

1. A real run whose pipeline was deleted while it executed, and which then finishes successfully, answers 404 (`Pipeline not found: <id>`), not 409. A run that was reaped (pipeline still exists) still answers 409 as today.
2. The "is the run still open?" check runs inside the same database transaction as each node's snapshot/history/payload write and holds the run row against a concurrent reap until that transaction commits, so a run reaped before a node's write cannot write that node's snapshot or history. A run deleted with its pipeline before a node's write is treated the same way (and answers 404 per item 1).
3. The `reapStaleRunsInternal` and `isRunOpenInternal` call sites (and the new in-transaction guard's privileged call) carry the inline comment DbContext.withSystemContext requires, explaining why bypassing RLS is correct there.

The ops note is a release-time action against prod and is out of scope for this change (no prod data is touched by delivery).
