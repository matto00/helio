## MODIFIED Requirements

### Requirement: Auto-run submissions enter through the guarded submission path as the pipeline owner
The system SHALL submit every auto-run through the same `PipelineRunService.submit` path every
other trigger (manual, external hook, scheduled) uses, attributed to the pipeline's owner as the
acting principal, and SHALL therefore be subject to the pipeline-run rate limit and concurrency cap
identically to every other trigger source. A guard-rejected auto-run SHALL NOT be silently dropped:
it SHALL be re-attempted (through the same guarded path, never bypassing it) no earlier than the
rejection's Retry-After interval, at most a configured number of times
(`PIPELINE_RUN_AUTO_RUN_MAX_RETRIES`, default 10) per pending write; once that cap is exhausted the
pending auto-run SHALL be dropped and the drop SHALL be logged at WARN level naming the pipeline and
the number of attempts. A fresh dataset write that re-schedules the debounce SHALL start a new retry
allowance.

#### Scenario: An auto-run is rejected by the per-user rate limit
- **WHEN** a pipeline owner has already reached the configured pipeline-run rate limit at the
  moment a debounced auto-run would fire
- **THEN** the auto-run is not submitted on that tick, no exception escapes to crash the process
  driving the auto-run, and the pending auto-run remains scheduled for a re-attempt no earlier than
  the rejection's Retry-After

#### Scenario: A rate-limited auto-run runs once the rate window allows it
- **WHEN** a debounced auto-run is rejected by the per-user rate limit and the owner's rate window
  subsequently resets with no further dataset write
- **THEN** exactly one run of that pipeline is submitted after the window resets, and it includes
  the write that scheduled the auto-run

#### Scenario: An auto-run rejected by the concurrency cap runs once a slot frees
- **WHEN** a debounced auto-run is rejected because the pipeline owner is at the concurrency cap,
  and one of the owner's in-flight runs subsequently completes
- **THEN** exactly one run of that pipeline is submitted on a re-attempt after the advisory
  Retry-After, without exceeding the concurrency cap

#### Scenario: An auto-run counts against the pipeline owner, not the writing user
- **WHEN** a dataset write is submitted by a user who is not the owner of a downstream pipeline
  reading that dataset (e.g. an editor grantee's own data source bound as a root on another user's
  pipeline)
- **THEN** the resulting auto-run, if any, is attributed to and counts against the pipeline
  owner's rate limit and concurrency cap, not the writing user's

#### Scenario: A guard-rejected auto-run's debounce claim is released without a retry storm
- **WHEN** a debounced auto-run is rejected by the pipeline-run guard on every attempt and no
  further dataset write occurs
- **THEN** the debounce claim is released (not left stuck) after every attempt, no attempt occurs
  earlier than the previous rejection's Retry-After, at most one attempt per pipeline occurs per
  scheduler tick, and after the configured maximum number of re-attempts the pending auto-run is
  removed and a WARN is logged — no further fire attempt for that write occurs on any later tick
  unless a NEW dataset write re-schedules the debounce

## ADDED Requirements

### Requirement: An auto-run that finds the pipeline already running fires after that run completes
When a debounced auto-run comes due while the same pipeline already has an active (not yet
completed) run, the system SHALL NOT submit a second concurrent run and SHALL NOT discard the
pending auto-run. The pending auto-run SHALL remain scheduled and SHALL fire exactly once on the
first scheduler tick after the active run completes (still subject to the fire-time eligibility
re-check and the pipeline-run guard). Waiting on an active run SHALL NOT consume the guard-retry
allowance. Further dataset writes while it waits SHALL continue to coalesce into that same single
pending auto-run.

#### Scenario: A write lands while the pipeline's run is in flight
- **WHEN** a dataset write schedules a debounced auto-run and the debounce comes due while the
  pipeline's previous run is still in flight
- **THEN** no run is submitted while the previous run is active, and exactly one further run of
  that pipeline is submitted on the first tick after the previous run completes

#### Scenario: Several writes during one in-flight run still produce one follow-up run
- **WHEN** several dataset writes land while the pipeline's run is in flight and their debounce
  comes due before it completes
- **THEN** exactly one follow-up run is submitted after the in-flight run completes, not one per
  write
