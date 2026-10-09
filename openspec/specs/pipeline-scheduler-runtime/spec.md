# pipeline-scheduler-runtime Specification

## Purpose
In-process, restart-safe firing of due `pipeline_schedules` through the existing
`PipelineRunService` run-submission path, with an overlap guard and a documented catch-up policy.

## Requirements

### Requirement: Due schedules fire runs through the existing run-submission path
The system SHALL periodically identify enabled pipeline schedules whose `next_run_at` is at or
before the current time and submit a run for each via the existing pipeline run-submission service,
executed as the pipeline's owner. Runs submitted by the scheduler SHALL persist
`trigger_source = 'scheduled'`.

#### Scenario: Due cron schedule fires a run
- **WHEN** an enabled cron schedule's `next_run_at` is at or before the current tick's time
- **THEN** the system submits a non-dry run for that schedule's pipeline as the pipeline owner,
  and the run appears in that pipeline's run history

#### Scenario: Due interval schedule fires a run
- **WHEN** an enabled interval schedule's `next_run_at` is at or before the current tick's time
- **THEN** the system submits a non-dry run for that schedule's pipeline as the pipeline owner

#### Scenario: Pipeline without a schedule is never auto-run
- **WHEN** a pipeline has no `pipeline_schedules` row
- **THEN** the system never submits a run for that pipeline on its own initiative

#### Scenario: Scheduler-fired run is recorded as scheduled
- **WHEN** the scheduler submits a run for a due schedule
- **THEN** the resulting `pipeline_runs` row has `trigger_source = 'scheduled'`

### Requirement: No overlapping runs of the same pipeline from the scheduler
The system SHALL NOT submit a new scheduled run for a pipeline while a previous run of that same
pipeline (scheduled or manual) is still active.

#### Scenario: Overlap guard skips a still-running pipeline
- **WHEN** a schedule becomes due while its pipeline already has an active (not yet completed) run
- **THEN** the system skips submitting a new run for that tick and leaves the schedule's
  `next_run_at` unchanged so it is reconsidered on a later tick

#### Scenario: Overlap guard clears after the active run completes
- **WHEN** a pipeline's previously active run completes (success or failure)
- **THEN** a subsequent due tick for that pipeline's schedule is eligible to submit a new run

### Requirement: Restart-safe catch-up without a missed-run backlog
The system SHALL recompute `next_run_at` on first observation after it is unset, without firing a
run, and SHALL fire at most one run for any schedule found due after a restart — never a backlog of
missed occurrences.

#### Scenario: Fresh schedule does not fire immediately
- **WHEN** a schedule's `next_run_at` has never been computed (unset)
- **THEN** the system computes and persists its next occurrence without submitting a run for that
  observation

#### Scenario: Restart after downtime fires at most once
- **WHEN** the process restarts and a schedule's persisted `next_run_at` is in the past by any
  margin
- **THEN** the system submits at most one run for that schedule before advancing `next_run_at` to
  the next future occurrence

### Requirement: Scheduled-run failures are recorded in run history
The system SHALL record a scheduled run's failure in the same run-history store used for manual
runs, using the existing run-failure recording path.

#### Scenario: Scheduled run fails
- **WHEN** a scheduled run's pipeline execution fails
- **THEN** the failure is recorded in that pipeline's run history with a non-empty error, and no
  failure notification is sent (deferred; out of scope)

### Requirement: next_run_at and last_run_at are maintained by the runtime
The system SHALL update a schedule's `next_run_at` (and `last_run_at`, when a run was actually
submitted) after evaluating it on each tick.

#### Scenario: Bookkeeping after a fired run
- **WHEN** the system submits a run for a due schedule
- **THEN** it persists `last_run_at` as the fire time and `next_run_at` as the next computed
  occurrence after the fire time, regardless of whether the submitted run ultimately succeeds or
  fails

### Requirement: A due schedule whose pipeline has a misconfigured enabled step records a failed run without executing

When a due schedule fires, the scheduler SHALL evaluate the pipeline's enabled steps with the shared schema-independent step-config check (`PipelineAnalyzeService.stepConfigProblem`) before submitting. If any enabled step is misconfigured, the scheduler SHALL NOT submit or execute the run and SHALL NOT consume the pipeline-run rate-limit or concurrency budget. Instead it SHALL persist a failed, never-attempted run with trigger source `scheduled` whose error names the misconfigured step(s), trim the pipeline's run history to the same retention as a normal run, set the pipeline's last-run status to `failed`, and advance the schedule (`next_run_at` recomputed, `last_run_at` set) exactly as for a normal fire. Schema-derived analyze errors SHALL NOT gate a scheduled run. A disabled misconfigured step SHALL NOT gate.

#### Scenario: Pipeline made invalid after its schedule was saved
- **WHEN** a pipeline's schedule is saved while the pipeline is valid, an enabled step is later made misconfigured, and the schedule then becomes due
- **THEN** no run is submitted, a failed run with trigger source `scheduled` and a step-config error is recorded, the owner's rate-limit window count is unchanged, and the schedule's `next_run_at` advances

#### Scenario: Schema-derived analyze error does not gate a scheduled run
- **WHEN** a due schedule's pipeline has no step-config problem but analyze would report a schema-derived error
- **THEN** the run is submitted as before

#### Scenario: Fire-time evaluation fails
- **WHEN** the step-config evaluation for a due schedule fails with an error (including a stored step config that cannot be decoded)
- **THEN** no run is submitted, the error is logged, and the schedule advances to its next fire time, so it is not retried every tick

#### Scenario: Run history stays capped
- **WHEN** a schedule on a misconfigured pipeline fires more than ten times
- **THEN** at most ten runs are retained for that pipeline
