## Why

HEL-414 persisted per-pipeline schedules (cron/interval) but nothing fires them — `next_run_at`
and `last_run_at` are dead columns. Without a runtime, schedules are inert configuration. This
ships the in-process trigger that makes them actually run pipelines, restart-safely and without
overlap, reusing the existing manual-run path so DataType upserts and alert evaluation happen for
free.

## What Changes

- New `PipelineSchedulerService`: computes next-fire times for cron/interval schedules (hand-rolled,
  no new dependency — mirrors `PipelineScheduleService`'s existing cron-field validator), scans due
  schedules, guards against overlapping runs (in-memory in-flight set + a persisted
  active-run check), submits due runs through the existing `PipelineRunService.submit` as the
  pipeline owner, and updates `next_run_at`/`last_run_at` afterward.
- New privileged (system-context) repository methods on `PipelineScheduleRepository` /
  `PipelineRunRepository` to list all enabled schedules and check for an in-flight run,
  independent of any single owner's RLS scope (background-job callsite, mirrors existing
  `*Internal` methods).
- New thin Pekko actor started from `Main.scala`'s guardian, timer-driven, delegating each tick to
  `PipelineSchedulerService`. Injectable `Clock` abstraction so the service is unit-testable
  without real wall-clock waits.
- Catch-up policy (restart-safe): a schedule with `next_run_at` unset or in the past is treated
  uniformly — recomputed forward from "now" without firing when first observed after being unset,
  and fired at most once (never a backlog) when actually due. Documented in design.md.
- `PipelineScheduleService.put` resets `next_run_at` to unset whenever `kind`/`expression`/
  `timezone` change on an existing schedule (found during design-gate review — HEL-414's `put`
  unconditionally preserved the stale `next_run_at`, so an edited cadence silently kept firing on
  the old schedule until the stale occurrence elapsed). Unrelated edits (e.g. toggling `enabled`)
  still preserve it.
- No inline fully-qualified names (CONTRIBUTING.md).

## Capabilities

### New Capabilities

- `pipeline-scheduler-runtime`: in-process, restart-safe firing of due pipeline schedules through
  the existing run-submission path, with an overlap guard and a documented catch-up policy.

### Modified Capabilities

- `pipeline-schedule-crud-api`: `PUT .../schedule` now resets `next_run_at` when the cadence
  (`kind`/`expression`/`timezone`) changes, so the runtime picks up the new schedule on its next
  tick instead of waiting out the stale occurrence; unrelated edits (e.g. `enabled` only) still
  preserve `next_run_at`.
- `pipeline-schedule-persistence`: clarifies that `next_run_at`/`last_run_at` computation now
  lives in `pipeline-scheduler-runtime` (this change), not the repository — the repository
  requirement's normative behavior (persist caller-supplied values verbatim, no derivation inside
  the repository itself) is unchanged, only its "not computed by this ticket" framing is stale.

## Impact

- Backend only. New files under `com.helio.domain` (next-fire-time calculator), `com.helio.services`
  (`PipelineSchedulerService`), and `com.helio.app` (the actor). Modified: `Main.scala` (start the
  actor), `PipelineScheduleRepository` / `PipelineRunRepository` (new internal methods), `ApiRoutes`
  (expose the shared `PipelineRunService` instance so the scheduler reuses its cache/registry).
  No new Flyway migration (HEL-414 already shipped `next_run_at`/`last_run_at`). No frontend impact.
