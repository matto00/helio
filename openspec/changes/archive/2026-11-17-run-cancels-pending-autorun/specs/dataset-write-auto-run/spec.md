## ADDED Requirements

### Requirement: A successful run that read a dataset write cancels that write's pending auto-run
The system SHALL take, for every real (non-dry) run of a pipeline, an admission snapshot: a read of that pipeline's
pending dataset-write auto-run (its write generation, if any), made immediately before the run is admitted and so
before the run reads any source rows. When that run reaches a winning terminal `succeeded` write, the system SHALL
cancel the pipeline's pending auto-run only if no write has re-armed it since the admission snapshot; a write that arms
the auto-run after the admission snapshot SHALL keep its own auto-run. A write whose rows committed before the
snapshot but whose auto-run was armed after it MAY still produce a redundant auto-run. The cancellation SHALL complete
before the run's success is reported to its caller. A run that does not reach a winning `succeeded` terminal write (it
fails, is blocked by an assertion, fails its write-back, is refused admission, or is finalized as abandoned) SHALL
cancel nothing, so the pending auto-run fires as it would have without that run. Dry runs and previews SHALL never
cancel a pending auto-run. The cancellation SHALL be decided entirely from database state, so it is correct when the
write, the run and the scheduler tick are handled by different backend instances. The pipeline-run guards (rate
limit, concurrency cap, owner budget) and the guard-rejection re-arm and drop behaviour SHALL be unchanged; a pending
auto-run that a successful run cancels is simply no longer pending.

#### Scenario: A manual run after a write cancels the write's auto-run
- **WHEN** a dataset write arms a pending auto-run of pipeline P, and a manual real run of P then starts and succeeds
  before the auto-run fires
- **THEN** P's pending auto-run is removed, and no `auto-run` run of P is inserted for that write

#### Scenario: A write that lands during the run keeps its auto-run
- **WHEN** a real run of P has taken its admission snapshot, and a dataset write then arms P's auto-run before that
  run succeeds
- **THEN** the run's success does not remove P's pending auto-run, and it fires after its debounce window

#### Scenario: A failed run cancels nothing
- **WHEN** a dataset write arms a pending auto-run of P, and a real run of P then starts and ends `failed`
- **THEN** P's pending auto-run is still pending, and it fires after its debounce window as it would have without the
  failed run

#### Scenario: A dry run cancels nothing
- **WHEN** a dataset write arms a pending auto-run of P, and a dry run of P then succeeds
- **THEN** P's pending auto-run is still pending

## MODIFIED Requirements

### Requirement: An auto-run that finds the pipeline already running fires after that run completes
When a debounced auto-run comes due while the same pipeline already has an active (not yet
completed) run, the system SHALL NOT submit a second concurrent run and SHALL NOT discard the
pending auto-run. The pending auto-run SHALL remain scheduled and SHALL fire exactly once on the
first scheduler tick after the active run completes (still subject to the fire-time eligibility
re-check and the pipeline-run guard), UNLESS the active run is a real run that reaches a winning
`succeeded` terminal write and cancels the pending auto-run under "A successful run that read a dataset
write cancels that write's pending auto-run" (no write re-armed it since that run's admission snapshot),
in which case it SHALL NOT fire. Waiting on an active run SHALL NOT consume the guard-retry
allowance. Further dataset writes while it waits SHALL continue to coalesce into that same single
pending auto-run.

#### Scenario: A write lands while the pipeline's run is in flight
- **WHEN** a dataset write schedules a debounced auto-run (armed after the in-flight run's admission snapshot, or no
  in-flight run read it) and the debounce comes due while the pipeline's previous run is still in flight
- **THEN** no run is submitted while the previous run is active, and exactly one further run of
  that pipeline is submitted on the first tick after the previous run completes

#### Scenario: Several writes during one in-flight run still produce one follow-up run
- **WHEN** several dataset writes land while the pipeline's run is in flight and their debounce
  comes due before it completes
- **THEN** exactly one follow-up run is submitted after the in-flight run completes, not one per
  write

#### Scenario: A write the in-flight run already read does not fire after it succeeds
- **WHEN** a dataset write arms P's auto-run before a manual real run of P takes its admission snapshot, the debounce
  comes due while that run is in flight, and the run then succeeds with no further write
- **THEN** no run is submitted while the run is active, and no `auto-run` run of P is submitted after it completes
