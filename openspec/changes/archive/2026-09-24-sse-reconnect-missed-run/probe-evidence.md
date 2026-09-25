# HEL-1174 probe evidence (systematic-debugging law)

Recorded before any fix code was written (Decision 1 / tasks.md section 1). Two deterministic
backend integration tests, added at
`backend/src/test/scala/com/helio/api/routes/pipelines/SseReconnectGapProbeSpec.scala`, discriminate
candidates (a)-(e) from ticket.md / design.md Decision 1.

## Probe 1 — the reconnect gap (candidates a/b/c)

**Hypothesis:** `PipelineRunRegistry` has no backlog/replay. A terminal event published while no
subscriber is registered for a pipeline id (the reconnect gap between the fan-out manager's old
stream closing and its new `connect()` call registering) is permanently lost to the next
subscriber.

**Probe:** `SseReconnectGapProbeSpec` — "should drop a succeeded event published while no
subscriber is registered, permanently, to the next subscriber". Forces the exact interleaving
design.md Decision 1 point 1 specifies: subscribe, receive one terminal event (which clears the
registry's subscriber set as a side effect — confirmed via `subscriberCountForTest(pid) shouldBe
0`), publish a SECOND terminal `succeeded` event while zero subscribers are registered, then
resubscribe and assert nothing arrives within 1s.

**Probe output (2026-09-24, local run — `sbt "testOnly
com.helio.api.routes.pipelines.SseReconnectGapProbeSpec"`):**

```
[info] HEL-1174 probe 1 -- the reconnect gap (candidates a/b/c)
[info] - should drop a succeeded event published while no subscriber is registered, permanently, to the next subscriber
```

PASSED — confirming the hypothesis: `registry.subscriberCountForTest(pid)` is `0` immediately
after the first terminal event (the registry's own terminal-cleanup branch removes every
subscriber ref), and the second `publish` call while in that state is a documented no-op
(`broadcastLocal`'s `Option(refs.get(pipelineId))` is `None`) — the resubscribing client's stream
times out with nothing delivered. This is not timing-dependent; it reproduces on every run.

**Verdict:** candidates (a) (a run finishing inside the reconnect window with no replay) and (b)
(the new subscription registering after the event was published) are both real, structural
instances of this ONE root cause: **`PipelineRunRegistry` provides no persistence/replay across a
resubscribe, and the fan-out manager's reconnect is not atomic with the old stream's teardown** —
there is a real window where zero subscribers are registered. Candidate (c) (`watchTermination`
cleanup racing the new subscriber's ref) is a possible SECOND way to land in the same empty-set
state but is not required to explain the failure — the terminal-event cleanup path alone already
produces it deterministically, so (c) does not need to be separately probed to explain the CI
failures. All three candidates are closed by the SAME fix (Decisions 2-3): reconciling against the
durable `pipeline_runs` record on every (re)connect, regardless of which sub-path emptied the
subscriber set.

## Probe 2 — does a second run actually land? (candidate e)

**Hypothesis under test:** ticket.md candidate (e) — the second write never produces a run at all
(debounce claim not released, HEL-505 rate/concurrency guard rejecting it, or the cost gate).

**Probe:** `SseReconnectGapProbeSpec` — "should persist TWO succeeded pipeline_runs rows for two
runs submitted back-to-back...". Submits two real runs through `PipelineRunService.submit`
sequentially (each awaited to completion before the next starts) against the SAME pipeline, with
no `pipelineRunGuardRepo` wired (rate limit off — matches every other guard-off fixture in this
test suite, and is at least as permissive as the e2e's real dev-backend rate limit of 10/60s) but
WITH a real `pipelineRunRepo` (so the concurrency cap IS active, exactly like production —
`guardConfig` defaults to `PipelineRunGuardConfig.fromEnv()`'s production values). Then reads
`pipelineRunRepo.listByPipelineInternal(pid)` directly.

**Probe output (2026-09-24, same local run):**

```
[info] HEL-1174 probe 2 -- does a second run actually land? (candidate e)
[info] - should persist TWO succeeded pipeline_runs rows for two runs submitted back-to-back, under the same guard defaults the e2e's dev backend runs (no rate/concurrency rejection)
```

PASSED — `rows.count(_.status == "succeeded") shouldBe 2` held: both submissions returned
`Right(...)` and both landed as `succeeded` rows in `pipeline_runs`. Two back-to-back submissions
(far tighter than the e2e's real ~30-35s gap between writes) neither hit the rate limit nor the
concurrency cap (each run completes synchronously via the in-process engine before the next
submit begins, so the non-terminal-run count the cap checks is `0` at the second submit).

**Verdict:** candidate (e) is **falsified**. The run/guard/debounce layer is not silently
swallowing the second run under the guard defaults the e2e's dev backend actually runs with. This
is consistent with design.md's own code-level reading of `PipelineSchedulerService
.processAutoRunClaim` (the debounce claim is released in every branch) and confirms it with real
`pipeline_runs` evidence rather than code-reading alone.

## Overall verdict

**This is a plain bug, not a legitimate guard-policy rejection** — no ESCALATION is warranted.
Root cause: `PipelineRunRegistry`'s SSE channel is genuinely ephemeral with no replay, and
`pipelineRunFanout.ts`'s reconnect-after-terminal-event pattern (HEL-1094 D3) structurally creates
a window with zero registered subscribers between the old stream's terminal-triggered close and
the new stream's registration. A run that reaches a terminal status inside that window (probe 1)
is not a rare race — it is the DIRECT and only-sometimes-timed-right consequence of a real second
write reliably producing a real second run (probe 2) racing against a real, structural gap in the
push channel. Proceeding to design.md Decisions 2-3 (durable `pipeline_runs`-backed
reconcile-on-connect, `GET /api/pipelines/:id/runs/latest`) as implemented in this change.

Persisted via `scripts/concertino/persist-evidence.sh HEL-1174
openspec/changes/sse-reconnect-missed-run/probe-evidence.md`.
