## 1. Backend: next-fire-time calculator

- [x] 1.1 Add `com.helio.domain.CronSchedule` with `nextFireTime(kind, expression, timezone,
      after: Instant): Option[Instant]` — interval via `Instant.plus`; cron via minute-by-minute
      scan (reuse `PipelineScheduleService`'s field-bounds table shape), capped at ~4 years,
      `None` if never matched within the cap.

## 2. Backend: repository support (privileged/system-context)

- [x] 2.1 `PipelineScheduleRepository.listTickCandidatesInternal(now: Instant): Future[Vector[PipelineSchedule]]`
      — enabled schedules where `next_run_at IS NULL OR next_run_at <= now`, system context.
- [x] 2.2 `PipelineScheduleRepository.updateAfterTickInternal(id, nextRunAt: Option[Instant],
      lastRunAt: Option[Instant]): Future[Unit]` — system context, no `AuthenticatedUser`.
- [x] 2.3 `PipelineRunRepository.hasActiveRunInternal(pipelineId): Future[Boolean]` — any row for
      the pipeline with `completed_at IS NULL`, system context.

## 3. Backend: scheduler service

- [x] 3.1 Add `Clock` trait (`def now(): Instant`) + `SystemClock` default impl in `com.helio.domain`
      (or a shared util location consistent with existing conventions).
- [x] 3.2 `com.helio.services.PipelineSchedulerService(scheduleRepo, pipelineRepo, runRepo,
      pipelineRunService, clock)` with `tick(): Future[Unit]`: fetch tick candidates; for each,
      branch on `nextRunAt.isEmpty` (recompute-only, no fire) vs `nextRunAt <= now` (due — overlap
      guard via in-memory set + `hasActiveRunInternal`, then `submit` as owner via
      `pipelineRepo.findByIdInternal`, then bookkeeping regardless of submit outcome).
- [x] 3.3 In-memory in-flight `mutable.Set[String]` (pipeline IDs) guarding same-process overlap;
      always cleared via `andThen`/`transform` on the submit future.
- [x] 3.4 Log (warn) when `CronSchedule.nextFireTime` returns `None` for an enabled schedule
      (infeasible cron expression) instead of silently dropping it.

## 4. Backend: fix stale next_run_at on schedule edit (design-gate finding)

- [x] 4.1 `PipelineScheduleService.put`: when replacing an existing schedule, compare the request's
      `kind`/`expression`(trimmed)/`timezone` against `existingOpt`'s values; if any differ, set the
      new row's `nextRunAt = None` (was: always `existingOpt.flatMap(_.nextRunAt)`); otherwise
      preserve the existing `nextRunAt` unchanged. `lastRunAt` handling is untouched.

## 5. Backend: wiring

- [x] 5.1 `ApiRoutes.pipelineRunService`: `private val` → `val` (expose for reuse; no behavior
      change).
- [x] 5.2 Add `com.helio.app.PipelineSchedulerActor` (typed `Behaviors`, `timers.startSingleTimer`
      self-rescheduling after each `tick()` future completes — never overlapping ticks).
- [x] 5.3 Wire into `Main.scala` guardian: construct `PipelineSchedulerService` from the already-
      constructed repos + `apiRoutes.pipelineRunService`; spawn `PipelineSchedulerActor`; read
      `helio.scheduler.tick-interval-seconds` (default 30s, env `SCHEDULER_TICK_INTERVAL_SECONDS`)
      from `application.conf`.
- [x] 5.4 Add `helio.scheduler.tick-interval-seconds` stanza to `application.conf`.

## 6. Tests

- [x] 6.1 `CronSchedule` unit tests: interval next-fire, cron next-fire (including timezone
      handling and an infeasible-expression `None` case).
- [x] 6.2 `PipelineSchedulerServiceSpec` (embedded Postgres, mirrors `AlertEvaluationServiceSpec`
      fixture shape) with an injected fake `Clock`:
      - due cron/interval schedule fires a run and updates `next_run_at`/`last_run_at`
      - overlap guard: a still-active run (persisted `completedAt IS NULL`) blocks a new fire
      - overlap guard: two back-to-back `tick()` calls before the first submit's future resolves
        result in only one submit (in-memory guard)
      - restart/null recompute: `next_run_at IS NULL` computes forward without submitting a run
      - failure path: a failing run is recorded in `pipeline_runs` with a non-empty `error_log`,
        and `next_run_at`/`last_run_at` still advance
      - pipeline without a schedule is never submitted
- [x] 6.3 `PipelineScheduleServiceSpec` (existing file): add cases for the `put` reset-on-edit fix —
      changing `expression` resets `next_run_at` to unset; changing only `enabled` preserves a
      previously-computed `next_run_at`.
- [x] 6.4 `sbt test` green; `git commit -n` not used (or, if used, called out with an immediate
      fix commit per CLAUDE.md).
