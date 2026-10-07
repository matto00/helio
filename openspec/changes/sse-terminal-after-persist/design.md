## Context

See proposal.md (Why) and ticket.md (the evidence chain). Current state, from the code:

- `PipelineRunService` publishes every terminal event first and then starts the durable writes. `succeeded`:
  `onUnblockedRunSuccess` (publish at ~L1397, then `materializedWrites` / `updateLastRun` / `updateRunTerminal` / …).
  `failed`: `executeRunFailure` (~L1124), `onWriteBackFailure` (~L1328), `onBlockedRun` (~L1356). `dry_run`:
  `onDryRunSuccess` (~L1236, publish then `insertDryRun`).
- `PipelineRunRegistry.publish` broadcasts synchronously to local SSE subscribers, then `notifyRemote` (multi-instance
  bus). Neither path has replay.
- Client (`frontend/src/features/panels/services/pipelineRunFanout.ts`): a live terminal event fires the listeners,
  which refetch rows, and sets `lastObservedRunId = runId`. A later reconcile skips any `runs/latest` whose id equals
  `lastObservedRunId`. So a refetch that read stale state is never retried for that run. This is the correct client
  contract if, and only if, the server's terminal event implies the terminal state is readable.
- CI trace evidence (ticket.md): the stream closed on the terminal event 20 ms before the run's `completedAt`.
  `runs/latest` returned `queued` and `rows` returned 2 of 3. The reconnect 62 s later saw `succeeded`/3 but deduped
  it. The first run in the same test raced the same way and won by about 8 ms. That is why the flake is intermittent
  and load-dependent.

## Goals / Non-Goals

**Goals:** a terminal event is causally after the run's durable terminal state on every terminal path. A deterministic
red-first backend proof. A behaviour-preserving e2e helper consolidation.

**Non-Goals:** client changes, longer e2e waits, persisting `running`, event replay. Also no change to event payloads
or to the `queued`/`running`/`node-progress` timing.

## Decisions

**D1. Publish the terminal event after the path's own terminal-write Future completes.** Each terminal path keeps
deciding the same event (same status, `rowCount`, `errorLog`, `runId`). It publishes that event when its write
Future completes, success or failure, for example via `andThen`/`transformWith` around the existing write chain,
instead of before it. Alternatives rejected:
(a) Make the client retry when a refetch looks stale. The client cannot know which rows are "stale", and this would
    paper over a server contract violation that every other consumer (MCP, other tabs, the multi-instance bus) also
    sees.
(b) Publish after only `updateRunTerminal`. That is not enough for `succeeded`: the evidence shows the rows read was
    also stale, so the `node_snapshots` writes must also precede the event.
Waiting on the whole existing chain (including alert evaluation / baseline upsert) is the simplest correct rule. The
added latency is the duration of those writes, which the `POST /run` response already waits for today. If the
executor finds a chain member whose duration is unbounded (e.g. a network call), it may publish after the
snapshot + run-status + last-run writes instead. It must record the reason in files-modified.md.

**D2. Exactly one terminal event, even when a terminal write fails.** Publishing on completion regardless of
outcome means a subscriber is never left waiting forever. This preserves today's "always gets a terminal event"
behaviour, and the event content stays what the path decided. The executor must confirm, by reading the code, that
no path can now publish twice. Example: a succeeded-path write failure that also reaches `executeRunFailure`.
Tests must assert a single terminal event per run.

**D3. Registry consumers.** Before changing the order, the executor enumerates every in-process consumer of
`registry.publish` / `PipelineRunNotifyBus`. It confirms that none depends on the terminal event arriving before the
writes (e.g. something that itself writes and would now deadlock or reorder). The enumeration goes in
files-modified.md.

**D4. The red-first proof is deterministic and uses lock-holding, not timing (skeptic-design-1 CR1, skeptic-design-2 CR1/CR2).**
The registry has no synchronous subscriber hook (`Source.actorRef`, an async mailbox hop, `final` classes). A "read
inside the callback" test could therefore pass on the pre-fix code. The spec holds database locks instead, always on a
**dedicated JDBC connection outside the service's Hikari pool**, so the test cannot exhaust the pool and deadlock.

- **Real-run cases** (succeeded, execution-exception `failed`, assertion-blocked `failed`, write-back-failure `failed`):
  - Inject a gating `PipelineExecutionBackend` that delegates to the real `InProcessExecutionBackend`, including
    `supportsWriteBack`, following the precedent at `PipelineRunGuardIntegrationSpec.scala:145`.
  - When `execute` is entered, the run row is already committed. The test takes `SELECT … FOR UPDATE` on that
    `pipeline_runs` row, then opens the gate.
  - For the exception case, the delegate's Future fails, or a real failing step is used.
  - For write-back failure, reuse the `PipelineRunServiceUpsertSourceSpec` undeclared-column fixture.
  - "Wait for the `running` event, then lock" without a gate is forbidden.
- **Succeeded snapshots:** additionally, before submit, take `LOCK TABLE node_snapshots IN EXCLUSIVE MODE`. Plain reads
  still work, and nothing on the run path before the publish writes `node_snapshots`. This blocks the replace even on
  a first run.
- **`dry_run`:** before submit, take `SELECT … FOR UPDATE` on the parent `pipelines` row. That blocks `insertDryRun`'s
  FK check. `FOR NO KEY UPDATE` does not.

While the locks are held, each case asserts:
1. No terminal event has reached a registry subscriber within a bounded window.
2. The durable state is still pre-terminal. The run status is not terminal. For `dry_run`, no `pipeline_runs` row
   exists yet for the run id, since none is inserted until `insertDryRun`.
3. Non-vacuity is checked per lock (skeptic-design-4 CR1).
   - Each lock is held on its **own** dedicated JDBC connection. In the succeeded case that means one connection for
     the `pipeline_runs` row and a separate one for the `node_snapshots` table lock.
   - For each lock, assert that some service backend `w` (a pid that is not any test connection's) has that lock's
     holder-connection pid in `pg_blocking_pids(w.pid)`.
   - A row-lock wait shows up as a `transactionid`/`tuple` wait, not as an ungranted relation lock, so assertions do
     not key on granted/ungranted relation entries for row locks.
   - Capture each holder's pid via `SELECT pg_backend_pid()` on that connection. "Test connection" means every
     dedicated connection the spec opens. Poll for the waiter within a bounded window (waiters attach
     asynchronously); a single immediate sample is not allowed.
   - Do not assert "exactly one waiter". `persistAssertions` may also legitimately queue behind the run-row lock.
4. Exactly one terminal event is published per run.

**The succeeded case uses a staged release (skeptic-design-3 CR1).** Steps:
1. Release the `pipeline_runs` row lock first, while still holding the `node_snapshots` table lock.
2. Assert again that no `succeeded` event arrives within the bounded window, and that a service backend has the
   `node_snapshots` lock-holder connection's pid in its `pg_blocking_pids`.
3. Release the table lock.
4. Assert that the event arrives and that the snapshot rows are the new run's.

This catches a partial fix that publishes after `updateRun` but before `materializedWrites`. The succeeded fixture
must bind at least one Output to an executed node, with a non-null `nodeSnapshotRepo`. Otherwise `materializedWrites`
is a no-op (~L1408), and the relation-specific waiter check fails loudly. For the other cases, release the locks and
assert that the event arrives with the durable state readable.

The red log, saved from unmodified code, must show the ordering assertion failing ("terminal event received while
write blocked"). A timeout or setup error does not count. If a lock cannot block some path's write as described, the
executor stops and reports that. It must not weaken the case.

Rejected alternative: a production-code injectable publish seam. It is a larger surface than this test-only need.

**D5. e2e helper consolidation is behaviour-preserving.** `e2e/support/auth.ts` already exports `uniqueEmail(prefix,
label?, domain)`, `registerUser` and `registerAndLogin`. Each local `uniqueEmail(label)` becomes the shared one with
that spec's prefix/domain, so generated emails keep the exact shape. The three `registerThenLogin` copies (hel1277,
hel1350, hel1351) need the user id (`GET /api/auth/me`), and hel1277 sets the tier between register and login. Add a
small shared helper, e.g. `currentUserId(request)`, and compose `registerUser` → user id → (tier) → `loginThenIsolate`
at the call site. Do not hide the tier step inside the shared helper. Display names, log lines and the isolate step
stay as they are.

## Risks / Trade-offs

- [The terminal event now lags by the write duration] → acceptable. The UI already shows `running` until then, and
  `POST /run` waits for the same work.
- [Hidden consumer reliant on early publish] → D3 enumeration plus the full backend suite.
- [HEL-1331 runs in parallel and may touch hel1277] → keep the hel1277 diff to the helper swap only. Rebase
  conflicts are resolved at Delivery.
- [`onUnblockedRunSuccess`'s for-comprehension fails fast: if `materializedWrites` fails, publish-on-completion can
  fire while the eager `updateRun` is still in flight] → accepted edge on the write-failure path only; files-modified.md
  states it explicitly rather than claiming "durable on every path".
- [No e2e reproduction of the race] → the deterministic backend spec is the proof. hel1094 repeat runs are
  regression evidence, not proof.

## Migration Plan

None. No schema, API or config change. Rollback is a revert.

## Planner Notes

- Self-approved: fixing the server ordering (product code) rather than only the spec. The ticket asks for the root
  cause, and the root cause is a product defect that affects real dashboards under load.
- Self-approved: including hel1351. It is a third `registerThenLogin` copy the ticket's enumeration missed, it
  matches the ticket's intent, and it is not touched by the parallel HEL-1331 lane.
- hel1094's 120 s waits remain unchanged.
