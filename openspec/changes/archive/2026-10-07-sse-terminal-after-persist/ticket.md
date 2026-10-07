# HEL-1366: hel1094 SSE fan-out e2e: second auto-run refresh misses 120s wait under CI

## Description

`e2e/hel1094-sse-fan-out-panel-refresh.spec.ts:199` failed once on CI (HEL-1330, PR matto00/helio#818, e2e (2)
attempt 1): the second auto-run refresh did not arrive within 120s. It passed 4/4 locally and passed on the CI re-run.
This flake has been seen before in this batch. Logs are in `.concertino/runs/HEL-1330/ci-logs/`.

Find the root cause from the failing log before changing the wait; don't just lengthen the timeout.

Also in scope, from the same lane: hel1277 and hel1350 still have local `registerThenLogin` copies, and about 12 specs
still define their own `uniqueEmail`. Move them onto the shared `e2e/support/auth.ts` that HEL-1330 added.

## Acceptance Criteria

- The root cause of the missed second refresh is established from evidence (the failing run's trace/backend log), and
  fixed at the cause. The 120s wait in hel1094 is not lengthened.
  - Root cause, found in Planning from the `playwright-report-shard-2` trace of CI run 37669132449 (copies in
    `.concertino/runs/HEL-1366/ci-evidence/`): the backend publishes a run's terminal SSE event (`succeeded`) before
    it commits the run's terminal status and the Output's `node_snapshots`
    (`PipelineRunService.onUnblockedRunSuccess`). The client reacted within about 20 ms, read `runs/latest` (still
    `queued`) and `rows` (still 2), and then marked the run as observed. Its later reconcile skipped that run id, so
    the panel never refreshed.
- A failing-first backend test proves that when a subscriber receives a run's terminal event, the run's durable state
  (the `pipeline_runs` terminal status, and for `succeeded` the materialized snapshot rows) is already readable. The
  test must be red against the pre-fix ordering. This covers every terminal path: succeeded, failed (execution
  exception, write-back failure, assertion-blocked) and dry_run.
- hel1094 passes repeatedly against the fixed backend (repeat run evidence, worker-capped).
- hel1277, hel1350 and hel1351 (the third copy, found in Planning) no longer define a local `registerThenLogin`.
  They use `e2e/support/auth.ts`, with the email shape, display name, logging, tier setup order and isolate
  behaviour preserved.
- The 11 specs that define a local `uniqueEmail` (auth-cookie-migration, hel665, hel666, hel716, hel908-full-flow,
  hel908-step-card-split, hel908-tail-attach, hel908-trunk-reorder-drag, hel908-trunk-reorder-order, hel912,
  hel958) import it from `e2e/support/auth.ts` instead, keeping each one's email shape. No e2e spec outside
  `e2e/support/` defines `uniqueEmail` or `registerThenLogin` afterwards.
