## MODIFIED Requirements

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
