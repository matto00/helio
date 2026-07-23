## Files modified

- `backend/src/main/scala/com/helio/domain/CronSchedule.scala` — new: hand-rolled next-fire-time
  calculator (`nextFireTime(kind, expression, timezone, after)`), interval via `Instant.plus`, cron
  via a minute-by-minute scan capped at ~4 years, mirroring `PipelineScheduleService`'s cron-field
  bounds shape (matching, not validating).
- `backend/src/main/scala/com/helio/domain/Clock.scala` — new: injectable `Clock` trait +
  `SystemClock` default, so `PipelineSchedulerService` is unit-testable without real wall-clock
  waits.
- `backend/src/main/scala/com/helio/services/PipelineSchedulerService.scala` — new: `tick()` scans
  due/needs-recompute schedules, applies the restart-safe catch-up policy (recompute-only when
  `nextRunAt` is unset; fire-once when due), the two-layer overlap guard (synchronized
  `mutable.Set[String]` in-memory + persisted `hasActiveRunInternal`), submits via the existing
  `PipelineRunService.submit` as the pipeline owner, and warns when a cron expression is
  infeasible.
- `backend/src/main/scala/com/helio/app/PipelineSchedulerActor.scala` — new: thin typed-actor timer
  wrapper around `PipelineSchedulerService.tick()`; first tick fires immediately at startup, each
  subsequent tick is armed only after the previous tick's `Future` completes (via
  `context.pipeToSelf`, never `timers.startSingleTimer` from an arbitrary dispatcher thread).
- `backend/src/main/scala/com/helio/infrastructure/PipelineScheduleRepository.scala` — added
  `listTickCandidatesInternal(now)` and `updateAfterTickInternal(id, nextRunAt, lastRunAt)`, both
  system-context (privileged background-job callsite, no request-bound user).
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — added
  `hasActiveRunInternal(pipelineId)` (persisted half of the overlap guard: `completed_at IS NULL`,
  system context).
- `backend/src/main/scala/com/helio/services/PipelineScheduleService.scala` — design-gate fix:
  `put` now resets `nextRunAt` to unset when `kind`/`expression`(trimmed)/`timezone` differ from
  the existing row (previously always preserved the stale value, so an edited cadence kept firing
  on the old schedule until that one occurrence elapsed); unrelated edits (e.g. `enabled` only)
  still preserve `nextRunAt`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — `pipelineRunService`: `private val` →
  `val` so `Main.scala` can hand the same instance to `PipelineSchedulerService` (shared
  `PipelineRunCache`/`PipelineRunRegistry` with manual runs; no behavior change).
- `backend/src/main/scala/com/helio/app/Main.scala` — wires `PipelineSchedulerService` from the
  already-constructed repos + `apiRoutes.pipelineRunService`, reads
  `helio.scheduler.tick-interval-seconds`, and spawns `PipelineSchedulerActor` as a guardian child.
- `backend/src/main/resources/application.conf` — added the `helio.scheduler.tick-interval-seconds`
  stanza (default 30s, env override `SCHEDULER_TICK_INTERVAL_SECONDS`).
- `backend/src/test/scala/com/helio/domain/CronScheduleSpec.scala` — new: interval next-fire (all
  four units), cron next-fire (simple/hour-boundary/list-range-step/timezone conversion), and the
  malformed-field-count and infeasible-expression (`0 0 30 2 *`) `None` cases.
- `backend/src/test/scala/com/helio/services/PipelineSchedulerServiceSpec.scala` — new: embedded-
  Postgres integration spec (mirrors `AlertEvaluationServiceSpec`'s fixture shape) covering due
  cron/interval firing + bookkeeping, no-schedule no-op, null/restart recompute without firing, the
  failure-recorded path, the persisted overlap guard, and the in-memory overlap guard (a
  deterministic promise-based hang/reach signal on a fake `FileSystem`, not a sleep-based race).
- `backend/src/test/scala/com/helio/services/PipelineScheduleServiceSpec.scala` — added cases for
  the `put` reset-on-edit fix: `kind`/`expression`/`timezone` changes each reset `nextRunAt`;
  changing only `enabled` preserves a previously-computed `nextRunAt`.

## Root cause / probe (systematic-debugging.md) — N/A

No bug was fixed in the sense of "existing code misbehaving under test." Section 4 (task 4.1) is a
design-gate-driven behavior fix to already-merged code (`PipelineScheduleService.put`, from
HEL-414) identified during this ticket's design review, not a regression discovered by a failing
test in this session. Its regression coverage is `PipelineScheduleServiceSpec`'s four new
reset-on-edit cases (section 6.3), which fail against the pre-fix `put` (always preserving
`nextRunAt`) and pass against the fix.
