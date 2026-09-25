# Files modified — HEL-1174

Base for this diff (resolved live via `scripts/concertino/resolve-review-base.sh`):
`78ebb3a6a035dd04503b719b247eb5e60298ff32`.

- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala` — adds
  `LatestRunResponse(id, status, completedAt, rowCount, errorLog)` (the `GET
  /api/pipelines/:id/runs/latest` response shape) and its `jsonFormat5` implicit.
- `backend/src/main/scala/com/helio/api/package.scala` — adds the `LatestRunResponse` type/val
  alias, matching the existing `RunStatusResponse`/`PipelineRunRecord` aggregator convention.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
  — adds `latestRunInternal(pipelineId)`: the single most recent `pipeline_runs` row (`ORDER BY
  started_at DESC LIMIT 1`, pushed down via `.take(1)` before `.result`), or `None` for a
  never-run pipeline. ACL-bypassing (system context), safe only after the caller's pipeline access
  is confirmed via `findByIdShared` — mirrors `listByPipelineInternal`'s existing contract.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — adds
  `latestRun(pipelineId, user)`: sharing-aware (`pipelineRepo.findByIdShared`) read backing the new
  route, deliberately NOT modeled on `status(runId)` (an ACL-less, opaque-run-id-keyed cache
  lookup — see design-gate round 1, change request 1). Also adds `runId = Some(runId.value)` to
  all 8 pre-existing `publish(pidStr, RunStatusEvent(...))` call sites (`queued`, `running`,
  `node-progress`, three `failed` sites, `dry_run`, `succeeded`) — design.md Decision 3, option (i):
  the live SSE wire payload now carries the run id so the client's live-event path can maintain its
  own dedup bookkeeping directly.
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunLatestRoutes.scala` (new) —
  `GET /api/pipelines/:id/runs/latest`. Sharing-aware, deliberately a SEPARATE route class/file
  from `PipelineRunStatusRoutes.scala` (not an addition to its `runs/:runId` handler) per
  design-gate round 1's two change requests: (1) ACL parity with `run-events`/`run-history`, not
  `runs/:runId`'s ACL-less lookup; (2) must be mounted/matched before `runs/:runId`'s `Segment`
  wildcard, or the literal `"latest"` segment is silently swallowed.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — mounts `PipelineRunLatestRoutes`
  immediately BEFORE `PipelineRunStatusRoutes` in the route `concat(...)`, with a comment naming
  the mount-order hazard (mirrors the existing HEL-955 "pending before ConnectorIdSegment"
  precedent in the same file).
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunRegistry.scala` — adds
  `runId: Option[String] = None` to `RunStatusEvent` and to `toSseBytes`'s wire encoding
  (design.md Decision 3, option (i)).
- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRunNotifyBus.scala` — threads
  `runId` through `encodePayload`/`decodePayload` too, so a client whose SSE connection is served
  by a DIFFERENT backend instance than the one that executed the run (HEL-1168) still gets `runId`
  on the live cross-instance-relayed event, not only via the `runs/latest` fallback.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — mounts the
  new route in `makeRoutes`'s `concat(...)` (before `PipelineRunStatusRoutes`, mirroring
  `ApiRoutes.scala`) and adds 6 new tests: never-run pipeline → 404, unknown pipeline → 404, 200
  with the correct (most recent) run's summary, viewer-grantee 200, no-grant 404
  (existence-not-leaked), and the mount-order regression itself (`runs/latest` not shadowed by
  `runs/:runId`'s wildcard — this is the request-level proof design-gate round 1's change request 2
  demanded, not just a compile check).
- `backend/src/test/scala/com/helio/api/routes/pipelines/SseReconnectGapProbeSpec.scala` (new) —
  the systematic-debugging probe (task 1, see `probe-evidence.md`): two tests confirming (1) the
  structural reconnect-gap drop at the `PipelineRunRegistry` level (candidates a/b/c), and (2) that
  two back-to-back runs both land as `succeeded` `pipeline_runs` rows under the e2e's actual guard
  defaults (falsifying candidate (e)).
- `frontend/src/features/panels/services/pipelineRunFanout.ts` — the client-side fix. Adds
  `entry.lastObservedRunId`, a `reconcile()` function that calls the new `runs/latest` endpoint at
  the start of every `connect()` (before the SSE fetch, sharing the same `AbortController`/signal),
  and dedup logic in the live SSE parse path comparing the event's `runId` against
  `lastObservedRunId`.
  - **One correction beyond design.md Decision 3's literal text, probe-confirmed live (not
    guessed):** the very FIRST reconcile call a subscriber's entry ever makes (`lastObservedRunId`
    still `undefined`) establishes the baseline WITHOUT firing, even when the pipeline's latest run
    is already `succeeded`. Design.md's literal wording ("compare... to `lastObservedRunId`
    (undefined initially). If it differs and status === 'succeeded', invoke every listener") would
    fire on this very first connect too. Running `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts`
    live surfaced that this breaks the spec's own "the status region is empty before any
    fan-out-triggered refresh" assertion: the test's own manual "first run" (seeding 1 row via
    direct API call, before the page ever loads) is exactly this case — a pipeline that already has
    a succeeded run at the moment a subscriber first mounts. Firing on it is redundant (the panel's
    own initial data fetch already reflects that run) and, per this test, an unwanted, visible side
    effect. The `pipeline-run-sse` spec delta's own scenario precondition ("a subscriber's
    connection has closed AFTER A PRIOR run's terminal event") independently supports this
    correction: the reconcile notify path is for a subscriber that already has a baseline (a
    genuine reconnect), not a brand-new mount. This was corrected in the implementation and its
    unit tests before committing — not left as a known gap.
  - **Cycle 2 fix (skeptic-final-1.md Change Request 1):** `reconcile()` now treats a non-terminal
    (`"queued"`/`"running"`) result as a complete no-op — it returns before ever touching
    `entry.lastObservedRunId`. See the "Cycle 2" section below for the full defect/fix/evidence
    trail.
- `frontend/src/features/panels/services/pipelineRunFanout.test.ts` — rewritten `createFetchMock`
  to route by URL (`/runs/latest` vs `/run-events`), added a `flushMicrotasks()` helper (one more
  `await` hop per `connect()` now that reconcile precedes the SSE fetch), updated every pre-existing
  test's fetch-call-count assertions to account for the new reconcile call, and added a new
  `describe` block (6 tests, cycles 1+2 combined) covering: no fire on first connect even when a run
  already succeeded; **cycle 2 — no fire on an in-flight (`"queued"`) run observed via reconcile,
  but the SAME run's terminal `succeeded` event still fires when it later arrives via live SSE**
  (skeptic-final-1.md's Change Request 1 regression test, RED/GREEN evidence in the Cycle 2 section
  below); the core AC-mandated reconnect-gap regression (a run completing entirely during the
  reconnect gap, observed purely via reconcile, no SSE push involved — manually verified RED with
  the reconcile call temporarily commented out, then GREEN restored, before cycle 1's commit); no
  double-fire for a run id observed via both reconcile and a live SSE event; no fire for a
  reconnect's reconcile reporting a new but non-succeeded run; no fire on a 404 (never-run
  pipeline).
- `frontend/src/features/pipelines/hooks/usePipelineRunEvents.ts` — adds an optional `runId?:
  string` field to `RunStatusEventData` for wire-shape parity with the now-larger `RunStatusEvent`
  payload (task 3.2's "confirm the hook tolerates an added, optional field gracefully" — it does;
  the field is never read by this hook). **No behavioral change** — task 3.3 confirmed this hook's
  single caller (`usePipelineDetailPage.ts`) never reconnects after a terminal event (the hook
  closes and returns; `TERMINAL_STATUSES` handling has no reconnect branch), so the reconnect-gap
  class of bug this ticket fixes does not apply here (design.md Non-Goals). **Separate, pre-existing,
  already-known gap, explicitly out of scope**: `usePipelineDetailPage.ts`'s own HEL-972 CR1 comment
  documents that a terminal event can still be missed if it fires before this hook's OWN first
  subscribe lands (a distinct race — a genuinely first-ever subscribe racing a run's completion, not
  a reconnect) and is already mitigated there by a time-bounded watchdog
  (`MAX_ANALYZE_DEFER_MS`), not by this ticket's reconciliation mechanism. Extending this ticket's
  fix to that hook was evaluated and declined as unnecessary scope creep — flagging as a possible
  follow-up candidate, not implementing it here.

## Root cause, probe, and probe output (systematic-debugging law)

- **Root cause:** `PipelineRunRegistry`'s SSE channel is genuinely ephemeral with no
  backlog/replay, and `pipelineRunFanout.ts`'s reconnect-after-every-terminal-event pattern
  (HEL-1094 D3) structurally creates a window with zero registered subscribers between the old
  stream's terminal-triggered close and the new stream's registration. A run that reaches a
  terminal status inside that window is silently and permanently lost to that subscriber.
- **Probe:** `SseReconnectGapProbeSpec.scala`, both tests (see `probe-evidence.md` for the full
  writeup persisted via `persist-evidence.sh`).
- **Probe output:**
  ```
  [info] HEL-1174 probe 1 -- the reconnect gap (candidates a/b/c)
  [info] - should drop a succeeded event published while no subscriber is registered, permanently, to the next subscriber
  [info] HEL-1174 probe 2 -- does a second run actually land? (candidate e)
  [info] - should persist TWO succeeded pipeline_runs rows for two runs submitted back-to-back, under the same guard defaults the e2e's dev backend runs (no rate/concurrency rejection)
  [info] Tests: succeeded 2, failed 0
  ```
  Candidate (e) is falsified (both runs land as `succeeded`); candidates (a)/(b) confirmed as one
  structural gap (candidate (c) is a possible second path into the same empty-subscriber-set state,
  not independently required to explain the failure).

## Fresh verification evidence (verification-before-completion law)

**Backend — `SseReconnectGapProbeSpec` alone:**
```
[info] Tests: succeeded 2, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

**Backend — `PipelineRunRoutesSpec` alone (52 tests, incl. the 6 new `runs/latest` tests):**
```
[info] Total number of tests run: 52
[info] Tests: succeeded 52, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

**Backend — full `sbt test`:**
```
[info] Run completed in 5 minutes, 43 seconds.
[info] Total number of tests run: 4831
[info] Suites: completed 330, aborted 0
[info] Tests: succeeded 4831, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
```

**Frontend/root — `npm test` (root Jest + frontend Jest):**
```
Test Suites: 28 passed, 28 total
Tests:       271 passed, 271 total
...
Test Suites: 340 passed, 340 total
Tests:       3711 passed, 3711 total
Snapshots:   1 passed, 1 total
```

**`npm run lint`:** clean (zero warnings, after fixing one `no-undef` on a stray `RequestInit`
type annotation in the new test file).

**`npm run typecheck`:** clean.

**`npm run format:check`:** clean (after `prettier --write` on `pipelineRunFanout.ts`).

**`npm --prefix frontend run build`:** succeeds (pre-existing chunk-size warning only, unrelated to
this change).

**RED-before/GREEN-after for the AC-mandated regression test** (systematic-debugging +
verification-before-completion): with `pipelineRunFanout.ts`'s `await reconcile(...)` call
temporarily commented out, `pipelineRunFanout.test.ts` produced 11 failures including the target
regression test:
```
FAIL src/features/panels/services/pipelineRunFanout.test.ts
  ● ... HEL-1174 regression: a run completing entirely during the reconnect gap is still observed via reconcile-on-connect
    expect(jest.fn()).toHaveBeenCalledTimes(expected)
    Expected number of calls: 2
    Received number of calls: 1
Tests:       11 failed, 4 passed, 15 total
```
Restoring the fix (confirmed byte-identical to the pre-revert file via `diff`) returned all 15
tests to green:
```
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

**e2e — `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts`, single run (first, to confirm the real
symptom before the loop):**
```
✓  1 ... a form panel submit's downstream auto-run visibly refreshes a bound table panel, with a computed a11y announcement, and survives a second run (1.2m)
1 passed (1.2m)
```

**e2e — 20x repeated loop, 3 workers, `nice -n 19`, unmodified timeouts/tick/debounce:**
```
Running 20 tests using 3 workers
✓ 1..20 (each run 41.6s-1.0m, matching the 5s debounce + up to one 30s scheduler tick + run + SSE
  delivery, twice per test, exactly as the spec's own header comment documents)

  20 passed (6.7m)
EXIT_CODE=0
```
Zero failures across all 20 runs; none of the spec's timing/assertions were modified.

## Cycle 2 — skeptic-final-1.md REFUTE, Change Request 1 (fixed)

The final-gate skeptic (`skeptic-final-1.md`) found and empirically reproduced a NEW dedup hole
introduced by cycle 1's "first-connect must not fire" correction: `PipelineRunRepository
.latestRunInternal` had no status filter, so it could (and would) return a **non-terminal**
(`"queued"`/`"running"`) row whenever a subscriber's `connect()` raced an in-flight run (an
ordinary page load/panel mount coinciding with any run in progress — a wider window than the
original reconnect race). `reconcile()` adopted that in-flight run's id as `entry.lastObservedRunId`
unconditionally, so when that SAME run's terminal `succeeded` event later arrived on the live SSE
path with the same `runId`, the live path's own dedup check already saw it as "observed" and never
fired — reopening the exact class of silent-data-loss bug this ticket exists to close.

**Fix (Change Request 1, direction (a) — client-side, the smaller diff, and the one directly
testable with the existing `pipelineRunFanout.test.ts` mock harness):** in `reconcile()`
(`frontend/src/features/panels/services/pipelineRunFanout.ts`), a reconcile result whose `status`
is not one of `TERMINAL_STATUSES` (`"succeeded"`/`"failed"`/`"dry_run"`) is now a complete no-op —
it returns before ever touching `entry.lastObservedRunId`. Direction (b) (backend-side: filter
`latestRunInternal`/`latestRun` to only ever surface a terminal row) was considered and rejected as
the PRIMARY fix — not because it's wrong, but because it would make the skeptic's own
literally-requested regression test ("reconcile's first call reports a queued/running run") describe
a state the backend could then never actually produce, collapsing it into the already-covered 404
case rather than directly proving the fix. (Direction (b) remains a reasonable independent
hardening candidate — not implemented here, to keep this cycle's diff minimal and focused on the
reported defect.)

**Regression test added** (`pipelineRunFanout.test.ts`, in the existing "reconcile-on-connect"
`describe` block): "fires when a run that was in-flight (queued) at mount time later succeeds via
the live SSE path, with the SAME run id" — reconcile's first call reports `{id: "run-inflight",
status: "queued"}`; the listener must not fire yet; the live SSE mock then delivers that SAME run's
`succeeded` event; the listener must fire exactly once.

**Re-verified (Change Request 2):** "does not fire on the very first connect, even when the
pipeline's latest run is already succeeded" (the cycle-1 deviation's own test) still passes
unchanged — a terminal `"succeeded"` status still reaches the (unchanged) first-observation
suppression logic below the new terminal-status guard.

**Change Request 3 (non-blocking):** not implemented — an explicit `pipeline-run-sse` spec.md
scenario for "reconcile observes a non-terminal run" was evaluated and left as an opportunity for a
follow-up, per its own "non-blocking" framing.

**RED-before/GREEN-after (fresh, this cycle):** with the new terminal-status guard temporarily
commented out, the new regression test failed exactly as the skeptic's own reproduction reported:
```
● ... fires when a run that was in-flight (queued) at mount time later succeeds via the live SSE path, with the SAME run id
  expect(jest.fn()).toHaveBeenCalledTimes(expected)
  Expected number of calls: 1
  Received number of calls: 0
Tests:       1 failed, 15 passed, 16 total
```
Restoring the fix (diff-verified byte-identical to the pre-revert file) returned all 16 tests to
green:
```
Test Suites: 1 passed, 1 total
Tests:       16 passed, 16 total
```

**Full verification gates re-run fresh, this cycle:**
- `npm run lint` — clean.
- `npm run typecheck` — clean.
- `npm run format:check` — clean.
- `npm test` (root + frontend Jest): `271 passed` + `3712 passed` (one more than cycle 1's 3711 —
  the new regression test), 0 failed.
- Full `sbt test`: `4831 passed, 0 failed` (6m02s).
- `e2e/hel1094-sse-fan-out-panel-refresh.spec.ts`, single fresh run: `1 passed (1.1m)`.

(The 20x e2e loop was not re-run this cycle — this cycle's fix is a pure frontend dedup-condition
change with no effect on the real backend/timing behavior the loop exercises, and cycle 1's 20x
loop plus this cycle's fresh single e2e pass are the evidence on file; a full 20x re-run remains
available on request.)

## Non-goals confirmed, per design.md

- `usePipelineRunEvents.ts` — confirmed no reconnect-after-terminal pattern; not extended (see
  above).
- No Flyway migration — no schema change; V111 remains free.
- `PipelineRunRegistry` itself was not given backlog/replay — the durable `pipeline_runs` table is
  the reconciliation source of truth instead, per design.md Decision 2's rejected-alternative
  analysis.
