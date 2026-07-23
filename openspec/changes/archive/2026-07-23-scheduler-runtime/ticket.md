# HEL-415: Scheduled runs: scheduler runtime (in-process trigger; restart-safe; no overlap)

Linear: https://linear.app/helioapp/issue/HEL-415/scheduled-runs-scheduler-runtime-in-process-trigger-restart-safe-no

## Context

With schedules persisted (HEL-414), the backend needs a runtime that fires pipeline runs when they come due. There is no scheduler today; the app boots a typed Pekko `ActorSystem` in `backend/src/main/scala/com/helio/app/Main.scala` (its `scheduler` is the natural timer), and runs are executed by `PipelineRunService.submit` (which currently requires an `AuthenticatedUser` — the runtime must run each pipeline as its owner). Single-instance only (per epic; distributed scheduling is out of scope).

This runtime is the internal analog of the external trigger endpoint in HEL-369 (related): an external scheduler can call HEL-369's hook; this ticket lets Helio fire schedules itself. Keep the split clean — reuse the same run-submission service, don't fork it.

## Scope

Backend:

* A scheduler component started from `Main.scala` guardian setup, using the Pekko scheduler (tick loop or per-schedule timers). On each due schedule: resolve the pipeline owner, submit a run via the existing `PipelineRunService` path (as the owner / a system-owner context), update `next_run_at`/`last_run_at`.
* No overlapping runs of the same pipeline: guard so a still-running scheduled pipeline is not re-submitted (in-memory in-flight set + a persisted running-state check).
* Restart-safe: on boot, recompute `next_run_at` from the schedule (don't fire a storm of missed runs; document the catch-up policy — e.g. skip missed, run next due).
* Basic failure handling: a failed scheduled run is recorded (reuse `PipelineRunRepository` / the existing run-failure path); a notification hook is explicitly deferred (see Out of scope).
* No inline fully-qualified names (CONTRIBUTING.md).

## Acceptance criteria

- [ ] Due schedules fire pipeline runs automatically via the existing run-submission service, executed as the pipeline owner.
- [ ] No two concurrent runs of the same pipeline from the scheduler; a due schedule whose previous run is still active is skipped/deferred.
- [ ] Restart-safe: after a restart the scheduler resumes from persisted schedules without firing a backlog of missed runs (documented catch-up policy).
- [ ] Scheduled-run failures are recorded in run history.
- [ ] Tests: due-schedule fires a run; overlap guard; restart recompute; failure recorded. Use a controllable clock/scheduler abstraction so tests are deterministic.
- [ ] Backward compatible: additive; pipelines without a schedule are never auto-run.

## Out of scope

* The failure NOTIFICATION (push/alert) on a failed scheduled run — relates to the v1.8 push + observability work; note it here, do NOT build it in this ticket.
* Retry/backoff policy (future).
* Distributed multi-instance scheduling (single instance today).
* The external trigger endpoint + scoped-token auth — owned by HEL-369 (related); this ticket reuses run submission, not that HTTP surface.

## Dependencies

* Blocked by HEL-414 (schedule model + persistence) — MERGED to main (PR #269, squash d908eb35).
* Related to HEL-369 (external trigger + token auth) — the external analog of this internal scheduler; keep run-submission logic shared.

## Batch context (from orchestrator's task brief)

This is ticket 2 of 4 in the strictly sequential HEL-340 scheduled-runs epic chain
(HEL-414 schedule model -> HEL-415 scheduler runtime -> HEL-416 config UI -> HEL-417 run provenance).

HEL-414 is MERGED to main (PR #269, squash d908eb35): it shipped `pipeline_schedules` (V62,
pipeline_id UNIQUE FK cascade, indirect-owner RLS via parent pipeline), `PipelineScheduleId`/
`ScheduleKind`(Cron|Interval)/`PipelineSchedule` domain types, `PipelineScheduleRepository`/
`Service`/`Routes`/`Protocol`, and `GET/PUT/DELETE /api/pipelines/:id/schedule` (PUT = upsert).
`next_run_at`/`last_run_at` are persisted nullable columns deliberately NOT computed by 414 —
computing and maintaining them is THIS ticket's job.

Additional seam context for planning (scope per the ticket): scheduled runs should fire through
the same `PipelineRunService` path as manual runs so that DataType row upserts and alert
evaluation (`AlertEvaluationService` via `onRunSuccess`, shipped in HEL-466) happen for free.
The app boots a typed Pekko `ActorSystem` in `Main.scala` whose scheduler is the natural trigger
mechanism. Ticket requirements per its title: in-process trigger, restart-safe, no overlapping
runs of the same pipeline. Likely no new Flyway migration needed (414 shipped the columns) —
verify rather than assume; if one IS needed, next available is V63.

Branch worktree from current main (d908eb35).
