# pipeline-scheduler-runtime Specification

## Purpose
In-process, restart-safe firing of due `pipeline_schedules` through the existing
`PipelineRunService` run-submission path, with an overlap guard and a documented catch-up policy.
## Requirements
### Requirement: Due schedules fire runs through the existing run-submission path
The system SHALL periodically identify enabled pipeline schedules whose `next_run_at` is at or
before the current time and submit a run for each via the existing pipeline run-submission service,
executed as the pipeline's owner.

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

