## Context

HEL-414 shipped `pipeline_schedules` (V62) with nullable `next_run_at`/`last_run_at` columns and
CRUD via `PipelineScheduleService`/`Repository`, but nothing computes or acts on them. `Main.scala`
boots a typed `ActorSystem[Nothing]`; `PipelineRunService.submit(pipelineId, isDry, user)` is the
sole run-submission path (owner-or-editor gated, wires DataType row upserts + `AlertEvaluationService`
via `onRunSuccess`). `pipeline_runs` has no explicit "running" status — a row is in flight from
`insertRun` (status `"queued"`) until `updateRunTerminal` sets `completedAt`; `completedAt IS NULL`
is therefore the correct "still active" predicate. No cron library is a dependency today —
`PipelineScheduleService.validateCron` hand-validates 5 space-separated fields per-field bounds
(no dependency, by design — mirrored here).

## Goals / Non-Goals

**Goals:**
- Fire due schedules through `PipelineRunService.submit`, as the pipeline owner.
- No two concurrent runs of one pipeline from the scheduler.
- Restart-safe with a documented, backlog-free catch-up policy.
- Deterministic tests via an injectable `Clock`, independent of the actor's real timer.

**Non-Goals:** failure notifications, retry/backoff, multi-instance coordination, the HEL-369
external trigger endpoint (out of scope per ticket).

## Decisions

**1. Hand-rolled next-fire-time calculator, no new dependency.** New `com.helio.domain.CronSchedule`
object: `nextFireTime(kind, expression, timezone, after: Instant): Option[Instant]`. For `Interval`,
`after.plus(n, unit)`. For `Cron`, converts `after` to `ZonedDateTime` in the schedule's timezone,
scans forward minute-by-minute against the 5 parsed fields (reusing `PipelineScheduleService`'s
field-bounds table, day-of-week mapped `DayOfWeek.getValue % 7` so Sunday=0), capped at ~4 years of
minutes; returns `None` (never fires) for an expression that can never match within the cap (e.g.
`0 0 30 2 *`) — logged as a warning at call time, not a validation-time rejection (existing
`validateCron` only checks per-field bounds, not day/month feasibility; closing that gap is out of
scope here). Alternative considered: add `cron4s`/`cron-utils` — rejected as a new external
dependency (planning-escalation trigger) for a bounded, already-precedented hand-rolled pattern.

**2. Unified due/needs-recompute handling — no separate "boot-only" code path.** A schedule is a
tick candidate when `enabled` and (`next_run_at IS NULL` OR `next_run_at <= now`). Two cases:
  - `next_run_at` unset (fresh from HEL-414's `PUT`, or every pre-existing row on first deploy of
    this change): compute `nextFireTime(..., after = now)` and persist it — **do not fire**. This
    is the "skip missed, run next due" catch-up policy: since only one scalar `next_run_at` is
    stored (no missed-occurrence queue), there is no backlog to replay.
  - `next_run_at <= now` (an actual due occurrence, whether on time or overdue from downtime):
    guard against overlap, fire once via `submit`, then recompute `next_run_at` from `now` and set
    `last_run_at = now`.
  This single `PipelineSchedulerService.tick()` method runs identically at actor startup (so a
  fresh deploy's first tick recomputes every unset row without firing a storm) and on every
  subsequent timer tick — no bespoke restart path to keep in sync with the regular one.

**3. Overlap guard — both layers, per the ticket's explicit ask.** In-memory `mutable.Set[String]`
(pipeline IDs), added before `submit` and removed in the future's `andThen` (regardless of
outcome) — the fast, same-tick guard. Persisted guard: new `PipelineRunRepository.hasActiveRunInternal
(pipelineId): Future[Boolean]` (`completedAt IS NULL`, system context) — catches a still-running
run across a scheduler restart, or a manually-submitted run in flight. Either guard skips the fire
for that tick (schedule's `next_run_at` is left unchanged so it is retried next tick).

**4. Owner resolution via existing `PipelineRepository.findByIdInternal`.** No new "system user"
concept — construct `AuthenticatedUser(pipeline.ownerId)` and call `submit`, which takes the
owner-permitted branch unconditionally. Matches "as the owner" from the ticket without inventing
a privileged bypass around `PipelineRunService`'s ACL check.

**5. Shared `PipelineRunService` instance.** `ApiRoutes.pipelineRunService` changes from `private`
to a plain `val`; `Main.scala` passes `apiRoutes.pipelineRunService` into the new actor after
constructing `ApiRoutes`. This reuses the same `PipelineRunCache`/`PipelineRunRegistry`, so a
client watching a pipeline's SSE stream sees scheduled runs exactly like manual ones — no
duplicated wiring, no divergent run-lifecycle behavior between the two trigger paths.

**6. Actor is a thin, minimally-tested timer wrapper.** `PipelineSchedulerActor` (typed `Behaviors`)
owns only: call `tick()`, on completion `timers.startSingleTimer` for the next interval (so ticks
never overlap even if a tick's async work outlasts the interval). All business logic — due
selection, overlap guard, submit, bookkeeping — lives in `PipelineSchedulerService`, tested
directly (embedded Postgres, mirroring `AlertEvaluationServiceSpec`) via `tick()` calls with an
injected fake `Clock`, without exercising Pekko's real timer at all. Tick interval: `helio.scheduler
.tick-interval-seconds` (default 30, env `SCHEDULER_TICK_INTERVAL_SECONDS`), read once in
`Main.scala`.

**7. `PUT .../schedule` resets `next_run_at` on cadence change (design-gate finding).**
`PipelineScheduleService.put` currently always preserves an existing row's `nextRunAt`
(`nextRunAt = existingOpt.flatMap(_.nextRunAt)`), even when the caller changes `kind`/`expression`/
`timezone`. Combined with Decision 2's rule that a schedule with a *future* `next_run_at` is left
untouched by every tick, an edited schedule would keep firing on its **stale, pre-edit** occurrence
until that one occurrence naturally elapses — only then would the new expression start governing.
Since HEL-416 (config UI, next in this epic chain) is the very next consumer of this same `PUT`,
this would be an immediately user-visible "my edit didn't take effect" bug. Fix: `put` computes
whether `kind`/`expression`/`timezone` differ from the existing row and, if so, resets `nextRunAt`
to `None` (leaving `lastRunAt` as historical bookkeeping, untouched) — this is exactly the "unset"
case Decision 2 already handles: the very
next tick recomputes forward from `now` under the new cadence **without firing immediately**, so
no spurious run fires purely because of an edit. An edit that only changes unrelated fields (e.g.
toggling `enabled`) still preserves `nextRunAt` — no unnecessary reset. Alternative considered:
document as a deferred limitation (matching the day/month-infeasibility risk's pattern) — rejected
because the fix is small, uses the design's own existing "unset" pathway (no new state machine),
and the bug would surface almost immediately in the next ticket of this chain.

**8. Overlap-guard test technique.** No real timer needed: seed a schedule due now, call `tick()`
once with a `PipelineRunService`/engine path that hangs on a controlled `Promise` (or a slow
data source) so the first `submit` future has not completed, call `tick()` again synchronously,
assert the second call performed no second `submit`/insert — then complete the promise and assert
cleanup. Mirrors existing embedded-Postgres service-spec fixtures; no `ExplicitlyTriggeredScheduler`
dependency introduced.

## Risks / Trade-offs

- [Minute-granularity cron scan cost for far-future/never-matching expressions] → capped at ~4
  years of minute-steps (~2.1M iterations worst case, background-thread, off the request path);
  documented as a known bound, not a correctness issue.
- [In-memory in-flight set is lost on restart] → the persisted `hasActiveRunInternal` check is the
  restart-safe backstop; the in-memory set only optimizes the common same-process case.
- [Day/month infeasible cron expressions silently never fire] → pre-existing validation gap in
  HEL-414's `validateCron`; logged as a warning at each tick evaluating that schedule, not silently
  swallowed. Full feasibility validation is a candidate follow-up, not this ticket's scope.

## Planner Notes

- Self-approved: no new Flyway migration (verified `next_run_at`/`last_run_at` already exist from
  V62; confirmed via `PipelineScheduleRepository`/`PipelineScheduleTable`).
- Self-approved: exposing `ApiRoutes.pipelineRunService` (private → val) is additive/internal, not
  an API contract change.
- Self-approved: no new external dependency (cron computation hand-rolled, matching HEL-414's
  existing decision).
