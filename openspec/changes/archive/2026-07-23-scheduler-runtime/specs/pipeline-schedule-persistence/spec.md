## RENAMED Requirements

- FROM: `### Requirement: next_run_at and last_run_at are not computed by this ticket`
- TO: `### Requirement: next_run_at and last_run_at are computed by the scheduler runtime, not the repository`

## MODIFIED Requirements

### Requirement: next_run_at and last_run_at are computed by the scheduler runtime, not the repository
`PipelineScheduleRepository` SHALL persist `next_run_at` and `last_run_at` as nullable,
caller-supplied fields and SHALL NOT itself derive `next_run_at` from `kind`/`expression` — that
computation is the responsibility of the scheduler runtime (`pipeline-scheduler-runtime`), which
computes and writes both fields via privileged repository calls after evaluating each schedule on
a tick. `PipelineScheduleService.put` additionally resets `next_run_at` to unset when replacing a
schedule with a changed cadence (see `pipeline-schedule-crud-api`), so the repository still only
ever persists a value it was explicitly given — it never computes one itself.

#### Scenario: Creating a schedule leaves next_run_at unset
- **WHEN** a schedule is created via the repository without an explicit `nextRunAt`
- **THEN** the persisted row's `next_run_at` is `NULL`

#### Scenario: Repository persists caller-computed values verbatim
- **WHEN** `upsert` is called with an explicit `nextRunAt`
- **THEN** the persisted row's `next_run_at` matches exactly what was supplied, unmodified by the
  repository
