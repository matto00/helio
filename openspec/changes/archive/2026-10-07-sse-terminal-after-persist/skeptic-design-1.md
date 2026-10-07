## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `54c2f222e09adcaa49fcf0b86bf643a3fc3f3426` (planning artifacts are uncommitted in the change dir).

### What I verified (with evidence)

**Root-cause claim: confirmed from ground truth.**
- Trace `.concertino/runs/HEL-1366/ci-evidence/trace.zip`, unzipped to my scratch dir, `1-trace.network`, pipeline `2450e99a…`, Output `047c5e13…`:
  - Run 2: `run-events` opened at 18:47:23.561 and lasted 30647 ms, so it closed at about 18:47:54.208. `runs/latest` was requested at 18:47:54.220 and returned `succeeded`, rowCount 2, completedAt 18:47:54.212376. `rows` then returned 2 items. This race was won by about 8 ms.
  - Run 3: `run-events` opened at 18:47:54.337 and lasted 29924 ms, so it closed at about 18:48:24.261. `runs/latest` at 18:48:24.284 returned `{"id":"e92aa937…","status":"queued"}`. `rows` at 18:48:24.366 returned 2 items (`6fd96235…json`). completedAt for e92aa937 was later read as 18:48:24.281097. The SSE stream closed about 20 ms before the terminal timestamp the service stamps before its writes.
  - The next reconnect was at 18:48:24.373. That stream ran 61188 ms and ended with a 502. `runs/latest` at 18:49:26.561 then returned e92aa937 `succeeded`/3. This matches the claimed chain.
- `PipelineRunService.scala`: every terminal path publishes before it starts its durable writes:
  - `executeRunFailure`: L1124 publishes, L1135 calls `updateRunTerminal`.
  - `onDryRunSuccess`: L1236 publishes, L1239 calls `insertDryRun`.
  - `onWriteBackFailure`: L1328 publishes, L1331 writes.
  - `onBlockedRun`: L1356 publishes, L1363 writes.
  - `onUnblockedRunSuccess`: L1397 publishes. `materializedWrites` starts at L1405, `updateRunTerminal` is at L1561, and the for-comprehension is at L1587-1595.
- `frontend/.../pipelineRunFanout.ts`:
  - L180 makes a non-terminal `runs/latest` a no-op.
  - L281/288: the live terminal event sets `lastObservedRunId`.
  - L175: a later reconcile returns early when the id is already in `lastObservedRunId`.
  - So the panel's stale refetch is never retried for that run. The client contract assumption in design.md is accurate.
- CI log `run1-22.log:1108` has a `hel1094-fanout` user at 18:47:18, which is consistent with the trace window. `backend.log` holds nothing run-specific, so the trace is the only direct evidence. That is sufficient.

**e2e enumeration: confirmed.**
- `grep -E "(function|const) uniqueEmail"` outside `e2e/support/` finds exactly the 11 specs listed in the ticket.
- `registerThenLogin` is defined in exactly hel1277, hel1350 and hel1351.
- `e2e/support/auth.ts` exports `uniqueEmail(prefix, label?, domain)`, `registerUser` and `registerAndLogin`. `loginThenIsolate` exists in `e2e/support/isolateLivePage`.
- hel1277's copy does register → `/api/auth/me` → tier → `loginThenIsolate`, which matches D5's description.

**Registry consumers (D3 premise).** The only `registry.subscribe` caller is `PipelineRunStreamRoutes.scala:44`. The only `registry.publish` caller is `PipelineRunService.scala:984`. The enumeration task is cheap and correctly scoped.

**Double-publish (D2).** A failure in `onUnblockedRunSuccess` fails `followUp`. `runFuture.transformWith` (L1086) wraps only the engine Future, so `executeRunFailure` cannot be reached a second time. D2's concern is well-placed, and the design asks the executor to confirm it.

### Verdict: REFUTE

The diagnosis and the fix direction (D1/D2) are sound. The red-first proof mechanism (D4), which the ticket's AC depends on, rests on a false premise. One AC case is also hedged out.

### Change Requests

1. **D4's determinism premise is false, and the mechanism it describes cannot be built against this registry (design.md D4, tasks.md 1.2).** D4 says the spec "subscribes to the registry. On receiving a terminal event, it reads the durable state from inside the callback… Today `publish` runs synchronously before the write Futures are even built, so the pre-fix code fails this deterministically." The registry has no synchronous subscriber callback:
   - `PipelineRunRegistry.subscribe` (`PipelineRunRegistry.scala` ~L93-115) returns an actor-backed `Source.actorRef`.
   - `broadcastLocal` delivers with `_ ! event`, an asynchronous mailbox hop followed by stream emission.
   - `PipelineRunRegistry` and `PipelineRunNotifyBus` are both `final class`, so a test cannot override `publish`/`notifyRemote` to get a synchronous hook.

   By the time a test consumer sees the element, `onUnblockedRunSuccess` has already returned past L1397 and started its eagerly-constructed write Futures (`updateMeta`, `updateRun` and the others are `val`s that run concurrently). Against embedded Postgres those writes may well commit before the test's read. The pre-fix test can therefore pass, or flake, which defeats the AC "must be red against the pre-fix ordering". Revise D4 and task 1.2 to name a mechanism that really is deterministic. Two options:
   - **(a) Lock-holding.** From a separate connection, hold a lock that blocks the path's terminal write:
     - `SELECT … FOR UPDATE` on the `pipeline_runs` row for the failed and succeeded paths.
     - For `succeeded` snapshots, a lock that blocks the `node_snapshots` replace.
     - For `dry_run`, a lock on the parent `pipelines` row, which blocks the FK check behind `insertDryRun`.

     Assert that no terminal event reaches a subscriber while the lock is held, within a bounded wait. Then release, and assert the event arrives with the durable state readable. Pre-fix, the event arrives while the write is blocked, which is deterministically red.
   - **(b) Injectable seam.** Add a small, explicitly injectable synchronous publish seam (e.g. a trait `PipelineRunService` publishes through), so the test can read and await the DB synchronously before `publish` returns. The design must also state that this is a production-code seam.

   Whichever is chosen, the saved red log must show the ordering assertion failing, not a timeout or setup error.

2. **The write-back-failure case is hedged ("where reachable in a spec") but the ticket AC requires it, and it is reachable (design.md D4, tasks.md 1.2).** The AC lists "failed (execution exception, write-back failure, assertion-blocked)" without qualification. `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceUpsertSourceSpec.scala` L184-199 ("validation… column the target hasn't declared") already drives a real run through `onWriteBackFailure` to a persisted `failed`. That fixture can be reused. Remove "where reachable" and make write-back failure a mandatory case in D4 and task 1.2.

### Non-blocking notes

- Spec delta scenarios: for an editor-grantee-triggered run, `insertRunIfUnderConcurrencyCap` returns `NotOwned` and no `pipeline_runs` row exists. "The latest run is that run with status `succeeded`" cannot hold there. Consider scoping the scenarios to runs that have a persisted row, or the backend test may be written against an unscoped claim.
- `onUnblockedRunSuccess`'s for-comprehension fails fast. If `materializedWrites` fails, a publish-on-completion can fire while `updateRun` (already started, eager `val`) is still in flight. That is an acceptable edge, but files-modified.md should say so explicitly rather than claim "durable on every path".
- Pre-existing and out of scope: a 429 from the rate limit or concurrency cap publishes `queued` (L1018) and never publishes a terminal event. Possibly worth a follow-up ticket.
- D1's "may publish after snapshot + run-status + last-run writes instead" escape hatch is fine. `alertEvaluation` is the likely candidate. Make sure the reason actually lands in files-modified.md.
