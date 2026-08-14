## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### Tooling note (not part of the verdict)

`WORKTREE_PATH/scripts/concertino/` in this worktree only contains
`assert-phase.sh`, `cleanup.sh`, `.concertino.env`, `README.md`, `setup-worktree.sh`,
`start-servers.sh` — it is missing `next-report-number.sh`, `persist-evidence.sh`, and
`emit-event.sh` (all present in the primary checkout's local, gitignored
`scripts/concertino/` copy, confirmed via `git check-ignore -v` — `scripts/concertino/`
is excluded by `.gitignore:57`, so these are untracked, locally-synced tooling, not
something `git worktree` propagates automatically). I could not run the prescribed
collision-check/persist/emit steps as a result. I independently verified no collision by
listing the change directory (`ls openspec/changes/authoring-error-telemetry/` showed only
`skeptic-design-1.md`) before writing this file directly to the filename the task
explicitly specified (`skeptic-design-2.md`). This is an environmental tooling gap for the
orchestrator to resolve (this worktree's `scripts/concertino/` needs a sync/copy from the
primary checkout), not a defect in the design under review — it does not change the
verdict below.

### What I verified (with evidence)

1. **CR1 (trace-context fix) — re-verified from source, not from the design's narrative.**
   Read `backend/src/main/scala/com/helio/infrastructure/MdcPropagatingExecutionContext.scala`
   and `backend/src/main/scala/com/helio/api/TraceContextDirective.scala` fresh (not reused
   from round 1). Confirmed the actual mechanism:
   - `TraceContextDirective.applyTrace` (`:65-75`) does two things on the **route-evaluation
     thread**, synchronously, before the inner route runs: `MDC.put(TraceMdcKey, value)` and
     `ctx.withExecutionContext(new MdcPropagatingExecutionContext(ctx.executionContext,
     MDC.getCopyOfContextMap))`. The MDC key is only removed in the outermost `finally`, after
     the entire inner route (sync or async) has completed.
   - `MdcPropagatingExecutionContext.execute` (`:34-44`) sets the captured `snapshot` on
     whatever thread actually runs a scheduled task, restoring the prior MDC afterward — this
     is a **data-carrying** primitive, independent of which dispatcher/pool a task lands on.
   - I traced the call chain from `ApiRoutes.scala:278-310` (`cors { traceContext.withTraceContext
     { ... authDirectives.authenticate { ... pathPrefix("authoring")... } } }`) through
     `AuthDirectives.authenticate` (`AuthDirectives.scala:72-82`, built on Pekko's own
     `onComplete` directive) to `DashboardAuthoringRoutes.scala:52`
     (`ServiceResponse.run(service.author(request, user))(identity)`). Pekko HTTP's `onComplete`/
     `entity(as[T])` directives resolve their continuation's `ExecutionContext` from
     **`ctx.executionContext`** (confirmed structurally, and empirically by
     `TraceContextDirectiveSpec.scala:147-182`, whose "async propagation" test builds a `Future`
     on a **foreign, empty-MDC executor** (`Executors.newSingleThreadExecutor()`, unrelated to
     any captured EC) and shows the trace **is** present on the `onComplete` callback's log line
     specifically because that callback resolves via `ctx.executionContext` — i.e., the identical
     "async continuation on a different EC than the one that produced the upstream Future" shape
     `DashboardAuthoringService` has). So by the time `DashboardAuthoringRoutes` calls
     `service.author`, whichever thread is executing has already had the trace-bearing MDC
     snapshot applied by the swapped `ctx.executionContext` (or, if every directive resolved
     synchronously, the original `MDC.put` from the route-evaluation thread is still live) —
     `MDC.getCopyOfContextMap()` captured at that call site genuinely reflects the trace id,
     regardless of which thread it runs on or whether an async boundary intervened.
   - design.md D3's fix — capture that snapshot at the route layer, thread it into
     `service.author`/`authorStreaming` as an explicit parameter (task 2.3), and wrap the
     telemetry emission in a **fresh** `new MdcPropagatingExecutionContext(ec, snapshot)`
     (task 2.2) — is architecturally sound and correctly generalizes to `DashboardAuthoringService`'s
     own class-level `ec = system.executionContext` chains, which the round-1 finding correctly
     identified as never touching `ctx.executionContext` at all.
   - **Streaming path check (explicitly asked for)**: `authorStreaming` (`DashboardAuthoringService.scala:84-88`)
     returns a `Source[AuthoringStreamEvent, NotUsed]` with no `onComplete`/`ctx.executionContext`
     touchpoint anywhere in its pipeline (`streamAttempt`/`completeStream`/`runStreamingRepair`,
     `:289-364`, run on the `Materializer`'s dispatcher). Because the design's fix threads the MDC
     snapshot as a **plain value** captured once at the route layer — not relying on any EC swap —
     it does not depend on Source materialization ever touching `ctx.executionContext`. Wrapping the
     terminal-outcome telemetry `Future` in `new MdcPropagatingExecutionContext(ec, snapshot)` inside
     the service works identically whether the surrounding code is a buffered `Future` chain or a
     `Source` stage, since the primitive only cares about the snapshot value and an
     `ExecutionContextExecutor` to delegate to — not about `ctx` at all. This is a real fix for the
     streaming path, not just an assertion.
   - **Non-blocking implementation nit found in this re-verification**: `DashboardAuthoringService`
     declares `(implicit ec: ExecutionContext)` (`:51`) — the constructor parameter's *static* type is
     the bare `ExecutionContext` trait, not `ExecutionContextExecutor`. `MdcPropagatingExecutionContext`'s
     constructor requires `delegate: ExecutionContextExecutor` (`MdcPropagatingExecutionContext.scala:29-31`).
     Even though the actual runtime object passed in from `ApiRoutes.scala:110`
     (`private implicit val ec = system.executionContext`, itself declared `ExecutionContextExecutor`
     per `pekko-actor-typed`'s `ActorSystem.executionContext: ExecutionContextExecutor`) *is* an
     `ExecutionContextExecutor`, Scala won't let `new MdcPropagatingExecutionContext(ec, snapshot)`
     compile inside `DashboardAuthoringService` as literally written in task 2.2/D3, because `ec`'s
     static type there is the narrower `ExecutionContext`. This is a one-line fix during implementation
     (widen the service's implicit parameter to `ExecutionContextExecutor`, or cast/pattern-match) —
     it would fail loudly at `sbt compile`, not ship as a silent runtime gap the way round 1's finding
     would have, so I'm not treating it as blocking. Flagging it so the executor doesn't have to
     rediscover it mid-implementation.

2. **CR2 (D1 rationale) — resolved.** design.md's current D1 (`design.md:28-44`) now states the real
   reason plainly: `ServiceResponse.completeError` is `private` and hardcodes `ErrorResponse(m)`,
   explicitly disclaiming the earlier SSE-precedent framing ("not the SSE-precedent framing an earlier
   draft used, which doesn't actually apply — `DashboardAuthoringRoutes` already uses the generic
   `ServiceResponse.run` for both its non-streaming endpoints today"). Re-checked
   `DashboardAuthoringRoutes.scala:52,63` fresh — still accurate, the route uses
   `ServiceResponse.run` for both non-streaming endpoints. Matches the change request exactly.

3. **CR3 (outcome enum self-approval) — resolved.** design.md D4 (`design.md:74-92`) now carries an
   explicit "Why the literal AC enum ... is realized as two separate ... events" paragraph, and
   Planner Notes (`design.md:130-140`) explicitly lists "the correlation-endpoint design and its
   `generated`/`failed`/`accepted`/`rejected` two-event realization of the AC's literal
   `{accepted,rejected,failed}` enum (D4, ... flagged explicitly here per the design-gate review that
   caught it was previously undocumented as a judgment call)" — a real, specific self-approval, not
   generic hedging.

4. **tasks.md changes match the design.md fix.** Task 2.2 (`tasks.md:18-24`) adds the telemetry helper
   "taking an explicit MDC snapshot parameter (design.md D3 — do NOT rely on ambient `ec`/MDC state)"
   and wraps the log emission in `Future(...)(new MdcPropagatingExecutionContext(ec, mdcSnapshot))`.
   Task 2.3 (`tasks.md:25-29`, new) threads `MDC.getCopyOfContextMap` from the route into both service
   methods. Task 5.1 (`tasks.md:54-61`) now explicitly requires asserting
   `logging.googleapis.com/trace` is present on an emitted telemetry log line, for **both** the
   buffered and streaming paths — closing the exact test gap round 1 flagged (a claim that would have
   shipped unverified).

5. **`openspec validate authoring-error-telemetry --strict`** → `Change 'authoring-error-telemetry' is
   valid` (ran fresh, output pasted, not assumed).

6. **Line budgets** (checked against `openspec instructions design/tasks --change
   authoring-error-telemetry`, which state "Maximum 150 lines; wrap prose at 120 chars per line" for
   design.md and "Maximum 80 lines" for tasks.md):
   - `design.md`: 144 lines (`wc -l`), longest line 102 chars (`awk '{print length}' | sort -rn`) — within
     both limits.
   - `tasks.md`: 71 lines, longest line 103 chars — within the 80-line limit (tasks.md has no stated
     per-line character cap, but 103 is reasonable and matches its existing wrapped-continuation style
     from round 1, which was not previously flagged).

### Verdict: CONFIRM

All three round-1 change requests are genuinely resolved in the current file contents, not just
asserted. I independently re-derived the trace-propagation mechanism from
`MdcPropagatingExecutionContext.scala`/`TraceContextDirective.scala`/`AuthDirectives.scala`/
`ApiRoutes.scala`/`DashboardAuthoringService.scala` (fresh reads, not reused from round 1 or the
executor's narrative) and confirmed the proposed fix — capture the MDC snapshot as data at the route
layer, thread it explicitly into the service, wrap terminal-outcome telemetry emission in a fresh
`MdcPropagatingExecutionContext` — is sound for both the buffered and streaming paths, unlike the
round-1 design's "no new plumbing needed" claim, which was concretely wrong. `openspec validate` passes
and both artifacts are within their line budgets.

### Non-blocking notes

- `DashboardAuthoringService`'s `(implicit ec: ExecutionContext)` (`DashboardAuthoringService.scala:51`)
  needs to become (or be locally cast/matched to) `ExecutionContextExecutor` for task 2.2's
  `new MdcPropagatingExecutionContext(ec, mdcSnapshot)` to compile as literally described — a one-line
  implementation fix, not a design change, and one that fails loudly at compile time rather than
  shipping silently broken.
- This worktree's `scripts/concertino/` is missing `next-report-number.sh`, `persist-evidence.sh`, and
  `emit-event.sh` (present in the primary checkout's local, gitignored copy). Recommend syncing this
  worktree's tooling before the next round depends on it.
