## Context

`e2e/hel1094-sse-fan-out-panel-refresh.spec.ts:209` has failed twice on `main`
(35934013358@853fb0a2, 36052610260@f272a605) plus once on PR #694's first attempt — always on the
**second** form submit, with the bound table panel stuck at 2 rows for the full 120s timeout. Owner
ruling (HEL-1174): this is the last blocker for the v0.8.4 release, alongside HEL-1169 (merged
78ebb3a6).

**Planning-time source read (orchestrator), before any code change — structural facts confirmed by
reading the tree, not yet a probe-confirmed root cause of the CI failures specifically:**

- `pipelineRunFanout.ts` (`connect()`) reconnects immediately after every terminal status
  (`succeeded`/`failed`/`dry_run`) as long as at least one listener remains (D3). Nothing runs
  between the old stream ending and the new `fetch(.../run-events)` call except a fresh
  `connect()` invocation — no delay, but not atomic either: the old stream's teardown and the new
  subscribe are two separate async steps with the event loop free to interleave between them.
- `PipelineRunRegistry.subscribe()` creates a brand-new `Source.actorRef` with **no backlog or
  replay** — `broadcastLocal` only reaches refs present in its `ConcurrentHashMap` at the moment
  `publish` runs. There is no "catch this subscriber up" path anywhere in the registry.
  `PipelineRunStreamRoutes` calls `registry.subscribe(...)` directly with no antecedent status
  check.
- The `pipeline-run-sse` spec already documents this as by-design ephemeral behavior ("Events
  SHALL be ephemeral — not persisted to the database") but only guarantees delivery for a client
  connected **before** the run starts — there is no requirement, and no code, covering a client
  that (re)connects after or during a run.
- `PipelineRunNotifyBus`'s own doc comment claims "a terminal run status is always still
  observable on next reconnect/poll" — this claim is **not actually implemented anywhere**; no
  reconnect or poll path fetches a run's current/latest status. This is a stale/aspirational
  comment describing behavior that does not exist, not evidence the gap is already closed.
- `pipeline_runs` (Flyway-backed, `PipelineRunRepository`) durably persists `id`, `status`,
  `startedAt`, `completedAt`, `rowCount`, `errorLog` for every run, independent of the SSE layer
  entirely. `PipelineRunService.history` (`GET /api/pipelines/:id/run-history`, already
  sharing-aware via `pipelineRepo.findByIdShared`) already reads this table back, sorted by
  `startedAt` desc. This durable record is what any reconciliation path should read from — it is
  authoritative across backend instances (HEL-1168), unlike the ephemeral push channel.
- HEL-505's guard defaults are generous relative to this test (`rateLimitPerWindow=10/60s`,
  `maxConcurrent=3`); the e2e makes exactly 2 run-triggering writes ~30-35s apart. A guard
  rejection is possible in principle but not the obvious explanation — must be probed, not assumed.
- HEL-1093's debounce claim/release (`PipelineSchedulerService.processAutoRunClaim`) always
  releases the claim in every branch (fired, skipped, guard-rejected) and self-heals a crashed
  claim after a generous stale-claim window — no obvious "second write silently never fires" bug
  on a read of the code, but again: read, not probed.

## Goals / Non-Goals

**Goals:**
- Confirm, by probe (systematic-debugging law — no fix without a probe-confirmed root cause), which
  of candidates (a)-(f) (ticket.md) actually explains the CI failures, discriminating in particular
  whether a second run is even created (e), which would make the SSE layer innocent.
- Implement AC bullet 2 regardless of which of (a)-(d) is confirmed: a subscriber crossing a
  reconnect (or connecting after a run already finished) must be able to learn the run's actual
  terminal outcome, sourced from the durable `pipeline_runs` record rather than the ephemeral push
  channel alone. This closes (a)/(b)/(c) uniformly, without needing to know which one actually fired
  in CI, and holds across backend instances (HEL-1168) because it reads through the shared database.
- Prove it: a deterministic test that forces the failing interleaving, red before the fix; the e2e
  passing in a 20x local repeat loop with zero failures; CI green on the real PR (not a re-run).

**Non-Goals:**
- Not touching `usePipelineRunEvents.ts` unless the probe shows it exhibits the same class of gap.
  On a first read it does not reconnect after a terminal event at all (it closes and returns) — it
  is used for a single explicit run-watch (e.g. a manual-run detail view), not a persistent
  fan-out, so the reconnect race does not obviously apply to it. Confirm during Execution before
  touching it; do not extend scope speculatively.
- Not adding event replay/backlog to `PipelineRunRegistry` itself (a bigger, riskier change to a
  shared low-level primitive) when reading the already-persisted `pipeline_runs` row accomplishes
  the same guarantee with less surface.
- Not changing the e2e spec's timeouts, tick interval, or debounce interval to paper over the
  symptom — an unmodified, currently-red e2e turning green is part of the proof.
- Not deciding a product question preemptively: if the probe finds the second run was legitimately
  guard-rejected (candidate (e), a real per-user rate/concurrency policy decision, not a bug), this
  is escalated with options/recommendation rather than resolved unilaterally in either direction.

## Decisions

### Decision 1 — Probe before fix (Task 1, Execution)
Before writing any fix code, discriminate (a)-(e) with evidence:
1. Reproduce locally: run the e2e (or a tighter repro script hitting the same seed/submit sequence)
   in a loop (`nice -n 19`, capped at 3-4 parallel workers per this machine's constraints) until it
   reproduces, or write a targeted backend integration test that forces the interleaving directly
   (open an SSE subscription, unsubscribe, publish a `succeeded` event for a fresh run into the
   registry *before* resubscribing, then resubscribe and assert nothing currently observes it —
   this proves the structural gap deterministically without needing wall-clock luck).
2. During a live repro, capture: the `pipeline_runs` row count and each row's `status`/`startedAt`/
   `completedAt` for the test's pipeline (via direct DB query or the existing `run-history`
   endpoint), and the `pipeline_auto_run_debounce` row's `fire_at`/`claimed_at` state, at the moment
   the panel is stuck. This directly answers (e): if a second `succeeded` row exists in
   `pipeline_runs`, the run happened and the SSE layer is guilty; if no second row (or one stuck
   `queued`/no row at all) exists, the debounce/guard layer is guilty instead and the reconciliation
   fix alone will not turn CI green — a different, smaller fix (or an escalation, if the guard
   rejection is a legitimate policy decision) is needed there instead.
3. Record the verdict — which candidate(s), with the evidence — as a persisted artifact (e.g.
   `probe-evidence.md` in the change dir, persisted via `persist-evidence.sh`) before proceeding to
   Decision 2's implementation.

### Decision 2 — Reconciliation source of truth: a new lightweight "latest run" read
Add `GET /api/pipelines/:id/runs/latest` (sharing-aware, same access pattern as the existing
`run-events` (`pipelineExistsShared`) and `run-history` (`findByIdShared`) routes: owner/editor/
viewer grantee → 200, no grant → 404, matches `pipeline-run-sse`'s existing access-control
requirements) returning the single most recent `pipeline_runs` row's `{id, status, completedAt,
rowCount, errorLog}` (the same field shape as the existing `RunStatusResponse` type, reused for
convenience — but **not** its access-control behavior), or `404` when the pipeline has never been
run.

**Correction (design-gate round 1, skeptic-design-1.md, change request 1):** the existing
`GET /api/pipelines/:id/runs/:runId` route (`PipelineRunStatusRoutes.scala`) is **not** a valid ACL
precedent for this new endpoint, despite sharing a response shape — it performs a bare in-memory
cache lookup (`runService.status(runId)`) with **no pipeline-ownership or sharing check at all**,
relying only on the run id being an unguessable opaque string. That is safe for a route keyed by
run id, but `runs/latest` is keyed by **pipeline id**, so copying that route's (lack of) access
control would leak any pipeline's latest run status/error detail to any authenticated user who
guesses or enumerates pipeline ids — a real cross-tenant authorization gap, not a style
inconsistency. `runs/latest` MUST perform the same `pipelineExistsShared`/`findByIdShared`-style
check `run-events`/`run-history` already do, and MUST NOT be implemented by extending or reusing
`runs/:runId`'s handler code.

**Route-matching precedence hazard (design-gate round 1, change request 2):**
`PipelineRunStatusRoutes.scala`'s existing `runs/:runId` route is `path("runs" / Segment) { runId
=> ... }` — a wildcard matcher, mounted in `ApiRoutes.scala` ahead of the pipeline run-history/
run-events routes. Pekko HTTP tries routes in the order they appear inside a `concat(...)`. If the
new `path("runs" / "latest")` route is appended to the same `concat(...)` **after** this existing
`Segment` branch (the naturally-reached-for place, since that file already owns the `runs/...`
sub-tree), the literal segment `"latest"` will match `Segment` first, bind `runId = "latest"`, and
fall into `runService.status("latest")` → `None` → `404 "Run not found: latest"` — permanently
unreachable, code-compiles-but-never-fires. The new `path("runs" / "latest")` branch MUST be placed
**before** the existing `path("runs" / Segment)` branch in whatever `concat(...)` ultimately serves
both (or otherwise structured, e.g. as a sibling route mounted earlier in `ApiRoutes.scala`, so the
literal `"latest"` segment can never fall through to the `Segment` matcher). Verify via an actual
request in a backend test, not just a compile check — this class of defect surfaces only at
request-routing time.

Alternative considered and rejected: reuse `GET /api/pipelines/:id/run-history` and take the first
element client-side. Rejected because `history` also fetches and joins every run's assertion rows
(`listAssertionsByRunInternal` per row) — real DB work this reconciliation path would trigger on
every SSE (re)connect, not just when a human opens the run-history panel. A dedicated single-row
read avoids that cost and keeps the two endpoints' purposes distinct.

### Decision 3 — Client-side: reconcile-on-connect, dedup by run id
In `pipelineRunFanout.ts`, at the start of every `connect()` call (covering the very first
subscribe, the D3 post-terminal reconnect, and a post-backoff retry alike), call the new
`runs/latest` endpoint before (or concurrently with, but resolved before acting on) opening the SSE
fetch:
- If the pipeline has no runs yet (`404`), do nothing further here — the live SSE fetch below
  covers everything from this point.
- Otherwise, compare the returned run `id` to `entry.lastObservedRunId` (a new field on
  `FanoutEntry`, `undefined` initially). If it differs and `status === "succeeded"`, invoke every
  listener in `entry.listeners` — exactly the same call already made on a live `succeeded` SSE
  event, so it is a single well-tested "notify" path either way. Set `entry.lastObservedRunId` to
  the returned id regardless of status (succeeded, failed, or dry_run), so a later `failed`/`dry_run`
  run correctly stops that id from ever being treated as "new" again.
- A run already observed by a live SSE `succeeded` event should also update
  `entry.lastObservedRunId` at that moment — but the current wire payload (`RunStatusEvent`) carries
  no `runId`. Two options, evaluated during Execution against actual diff size: (i) add `runId` to
  the SSE payload (`RunStatusEvent`/`toSseBytes`/the frontend `RunStatusEventData` type) so the live
  path can set `lastObservedRunId` directly and cheaply; or (ii) skip that and let the very next
  `connect()`'s reconciliation call (which always runs first, per this decision) re-fetch and find
  the *same* id it just fired for from the live path, since firing is only ever gated on
  `lastObservedRunId` at the time reconcile runs, and the live path already fired directly (not
  through the reconcile check) — order matters: if the live path fires and does NOT update
  `lastObservedRunId`, the *next* reconcile call (on the resulting D3 reconnect) would see the same
  run id as still "new" relative to its stale `lastObservedRunId` and refire once more, redundantly
  (a harmless extra Output refetch, not a correctness bug) unless a *third*, newer run has occurred
  by the reconnect completes first-fires for it and updates the baseline anyway, closing the window.
  **Recommendation: (i)** — a one-field wire addition is small, avoids the redundant-refire edge
  case entirely, and makes `lastObservedRunId` bookkeeping the same single code path everywhere
  (live event handler also sets `entry.lastObservedRunId = event.runId` before/when firing). Confirm
  during Execution and record the actual choice made plus why, if it changes.
- A reconciliation `succeeded` firing and a live `succeeded` event firing for the *same* run id
  must not double-fire: the dedup check (`id !== lastObservedRunId`) already prevents this as long
  as `lastObservedRunId` is updated at the point of firing, whichever path fires first.

### Decision 4 — Cross-instance correctness (HEL-1168)
Because `runs/latest` reads through the shared `pipeline_runs` table (not the in-memory
`PipelineRunRegistry` or the NOTIFY bus), it is correct regardless of which backend instance
executed the run or which instance is serving the client's SSE connection — no dependency on
`PipelineRunNotifyBus`'s self-echo guard or cross-instance delivery timing at all. This also means
the fix is agnostic to candidate (d) (self-echo guard bug): even if that guard were dropping a
legitimate local event, reconciliation still catches the outcome on the next connect.

## Risks / Trade-offs

- **Extra HTTP round-trip per (re)connect.** Bounded: only fires once per terminal event
  (existing D3 reconnect cadence), not on a timer/poll. Acceptable cost for closing a real data-loss
  gap.
- **Wire format change (Decision 3, option (i))** touches the backend `RunStatusEvent`/
  `toSseBytes` and the frontend `RunStatusEventData` parse in `usePipelineRunEvents.ts` too (shared
  wire shape) — must confirm that hook tolerates an added, optional field gracefully (it already
  spreads parsed fields into state loosely; a new field it does not read should be a no-op for it).
- **If probe confirms (e):** the reconciliation fix (Decisions 2-3) still ships — it is independently
  required by AC bullet 2 — but will not by itself turn the e2e green, since no second `succeeded`
  run exists to reconcile against. In that case a second, distinct fix (or an escalation, if the
  rejection is a legitimate guard policy call) is required before claiming AC bullet 3 met; do not
  claim the ticket done on the reconciliation change alone if the probe found (e).
