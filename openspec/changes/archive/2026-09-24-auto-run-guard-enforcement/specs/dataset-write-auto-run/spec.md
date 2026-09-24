## MODIFIED Requirements

### Requirement: Auto-run submissions enter through the guarded submission path as the pipeline owner
The system SHALL submit every auto-run through the same `PipelineRunService.submit` path every
other trigger (manual, external hook, scheduled) uses, attributed to the pipeline's owner as the
acting principal, and SHALL therefore be subject to the pipeline-run rate limit and concurrency cap
identically to every other trigger source. A guard-rejected auto-run SHALL be recorded (at minimum,
logged) rather than silently dropped.

#### Scenario: An auto-run is rejected by the per-user rate limit
- **WHEN** a pipeline owner has already reached the configured pipeline-run rate limit at the
  moment a debounced auto-run would fire
- **THEN** the auto-run is not submitted, the rejection is recorded, and no exception escapes to
  crash the process driving the auto-run

#### Scenario: An auto-run counts against the pipeline owner, not the writing user
- **WHEN** a dataset write is submitted by a user who is not the owner of a downstream pipeline
  reading that dataset (e.g. an editor grantee's own data source bound as a root on another user's
  pipeline)
- **THEN** the resulting auto-run, if any, is attributed to and counts against the pipeline
  owner's rate limit and concurrency cap, not the writing user's

#### Scenario: A guard-rejected auto-run's debounce claim is released without a retry storm
- **WHEN** a debounced auto-run's claim is rejected by the pipeline-run guard on a given scheduler
  tick
- **THEN** the debounce claim for that pipeline is released (not left stuck) on that same tick, and
  no further fire attempt for the SAME denied write occurs on any subsequent tick — a fresh fire
  attempt for that pipeline only occurs following a NEW dataset write that re-schedules the debounce
