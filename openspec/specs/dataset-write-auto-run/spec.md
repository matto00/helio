# dataset-write-auto-run Specification

## Purpose
A dataset write from an interactive panel schedules a debounced auto-run of every downstream
pipeline that reads it and passes the cheapness verdict, entering through the same guarded
submission path every other trigger uses, correct under a multi-instance deployment.

## Requirements

### Requirement: A dataset write debounces an auto-run of eligible downstream pipelines
The system SHALL, after a successful dataset row write (append, replace, patch, or delete) on a
`DatasetSource`, identify every pipeline whose root references that data source and, for each
pipeline whose `PipelineCostEstimator` verdict is `autoRunnable` at that time, schedule a debounced
auto-run: it SHALL NOT submit a run synchronously as part of the write request, and repeated writes
to the same data source within the debounce window SHALL coalesce into exactly one eventual run per
eligible pipeline, not one run per write.

#### Scenario: Ten rapid writes to a bound dataset produce one run
- **WHEN** ten row writes are submitted to the same dataset within a two-second window, and the
  window's quiet period subsequently elapses with no further write
- **THEN** exactly one row is inserted into `pipeline_runs` for each eligible downstream pipeline,
  not ten

#### Scenario: Ten rapid writes split across two backend instances still produce one run
- **WHEN** ten row writes to the same dataset are split across two concurrently-running backend
  instances within a two-second window, and the window's quiet period subsequently elapses
- **THEN** exactly one run is submitted per eligible downstream pipeline — the coalescing SHALL NOT
  depend on which instance handled which write

#### Scenario: A write during an in-flight debounce window pushes it forward
- **WHEN** a new write to the dataset occurs before a previously-scheduled debounce window has
  elapsed
- **THEN** the debounce window is extended from the new write's time, and no run fires until the
  window elapses with no further write

### Requirement: Only pipelines passing the cheapness verdict auto-run
The system SHALL NOT schedule an auto-run for a pipeline whose `PipelineCostEstimator` verdict is
not `autoRunnable` at the time eligibility is evaluated, and SHALL return the verdict's denial
reason(s) to the writer — never discarding them silently, and never merely logging them — SUBJECT
TO the visibility requirement below. The write response SHALL include, for each denied downstream
pipeline the writer has visibility into, its id, name, denial reasons, and whether the writing user
is permitted to trigger a manual run of it (`canRun`, mirroring the same owner-or-editor-grantee
check the manual run submission path enforces). Evaluation of every downstream pipeline's verdict
SHALL complete before the write response is returned — the write itself is not delayed on a
debounced RUN, only on the (already-computed-per-write) verdict evaluation. This requirement SHALL
apply identically to every row-mutation entry point sharing the underlying trigger path EXCEPT row
delete: append, form-append, replace, and patch. Row delete (`DELETE .../rows/:rowId`) is explicitly
OUT OF SCOPE for this requirement — it SHALL continue to only log a denial, exactly as before this
change, and SHALL NOT be required to return `204`-incompatible response content. Scheduling a
debounced auto-run for an ALLOWED pipeline SHALL be unaffected by this requirement.

A pipeline SHALL also be denied auto-run when any ENABLED step has a step-configuration problem as
reported by the same step-configuration validation the pipeline analyze surface uses (one shared
validator, never a parallel check). Such a denial SHALL carry one reason per misconfigured step with
code `step-config-invalid`, the step's id, and the validator's message, listed after any cheapness
reasons in step order — the same configuration-class reasons, in the same order, that analyze reports. A denied entry carrying a
`step-config-invalid` reason SHALL report `canRun: false` regardless of the writer's grant, because a
manual run of it is certain to fail. Validation problems that depend on a source's stored inferred
schema (rather than on the step's configuration alone) SHALL NOT deny auto-run.

#### Scenario: A denied pipeline is not auto-run
- **WHEN** a dataset write's downstream pipeline contains a step the cheapness verdict denies
  (e.g. an AI step), and the writing user has at least a viewer grant on that pipeline
- **THEN** no run is scheduled or submitted for that pipeline as a result of the write, and the
  write response includes that pipeline's id, name, and denial reason(s)

#### Scenario: The write response carries canRun for the writing user
- **WHEN** a dataset write is submitted by a user who is not the owner of a denied downstream
  pipeline, but holds an editor grant on it
- **THEN** the denied pipeline's entry in the write response has `canRun: true`

#### Scenario: A denied pipeline the writer can see but cannot run still reports its reason
- **WHEN** a dataset write's downstream pipeline is denied and the writing user holds only a
  viewer grant on that pipeline
- **THEN** the denied pipeline's entry in the write response has `canRun: false`, and its denial
  reason(s) are still present

#### Scenario: A denied pipeline the writer has no relationship to at all is omitted
- **WHEN** a dataset write's downstream pipeline is denied and the writing user holds no grant
  (owner, editor, or viewer) on that pipeline whatsoever
- **THEN** that pipeline does not appear anywhere in the write response — no id, name, or reason —
  though the denial is still logged server-side exactly as before this change

#### Scenario: A replace write reports a denial identically to an append write
- **WHEN** a `PUT` (replace) row write to a dataset denies a downstream pipeline the writer can see
- **THEN** the write response includes that pipeline's id, name, and denial reason(s), exactly as
  a `POST` (append) write would

#### Scenario: A patch write reports a denial identically to an append write
- **WHEN** a `PATCH` (single-row edit) write to a dataset denies a downstream pipeline the writer
  can see
- **THEN** the patch response includes that pipeline's id, name, and denial reason(s), exactly as
  a `POST` (append) write would

#### Scenario: A delete-triggered denial is not surfaced in the response
- **WHEN** a row `DELETE` causes a downstream pipeline to be denied auto-run
- **THEN** the `DELETE` response remains `204 No Content` with no body, and the denial is only
  logged server-side, exactly as before this change

#### Scenario: An allowed pipeline's debounce scheduling is unchanged
- **WHEN** a dataset write's downstream pipeline passes the cheapness verdict
- **THEN** a debounced auto-run is scheduled for it exactly as before this change, and it does not
  appear in the write response's denied-pipelines list

#### Scenario: A pipeline with a misconfigured enabled step is not auto-run
- **WHEN** a dataset write's downstream pipeline passes the cheapness verdict but one of its enabled
  steps has a step-configuration problem (e.g. a `compute` step with an empty target column), and the
  writing user owns that pipeline
- **THEN** no run is scheduled or submitted for that pipeline as a result of the write, and the write
  response includes that pipeline with a `step-config-invalid` reason naming the step, and
  `canRun: false`

#### Scenario: A disabled misconfigured step does not deny auto-run
- **WHEN** a dataset write's downstream pipeline's only misconfigured step is disabled
- **THEN** a debounced auto-run is scheduled for it exactly as for any other allowed pipeline

#### Scenario: A schema-derived validation problem does not deny auto-run
- **WHEN** a dataset write's downstream pipeline passes the cheapness verdict and has no
  step-configuration problem, but a step references a column absent from its source's stored
  inferred schema (so analyze may report a schema-derived validation error)
- **THEN** a debounced auto-run is still scheduled for it, and it does not appear in the write
  response's denied-pipelines list

#### Scenario: Cheapness and configuration denials are reported together
- **WHEN** a dataset write's downstream pipeline is denied by the cheapness verdict AND has a
  misconfigured enabled step
- **THEN** its write-response entry lists the cheapness reason(s) first, followed by the
  `step-config-invalid` reason(s), and has `canRun: false`

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

### Requirement: An auto-run trigger never itself cascades into a further auto-run
The system SHALL NOT treat a pipeline's own write-back output as a dataset write capable of
scheduling a further downstream auto-run — write-back-producing pipelines are already excluded from
auto-running by the cheapness verdict (`PipelineCostEstimator.WriteBackOps`), and this requirement
records that the auto-run trigger path itself introduces no additional cascade beyond that existing
exclusion.

#### Scenario: A pipeline's write-back step does not trigger a further auto-run
- **WHEN** a pipeline step writes rows into a dataset as part of its own run (a write-back step)
- **THEN** that write does not itself schedule a debounced auto-run of any pipeline reading the
  written-to dataset

### Requirement: The auto-run eligibility verdict is re-evaluated when the debounced run fires

When the scheduler claims a due auto-run debounce row, it SHALL re-evaluate the same eligibility verdict the write-time trigger computes (cost verdict plus schema-independent step-config check over enabled steps) before submitting. If the pipeline is denied at fire time, the scheduler SHALL NOT submit a run, SHALL log the denial reasons, and SHALL release the claim so the debounce row is removed. No failed run is recorded for a fire-time auto-run denial. Schema-derived analyze errors SHALL NOT deny.

#### Scenario: Config made invalid during the debounce window
- **WHEN** an allowed dataset write schedules a debounced auto-run and an enabled step is made misconfigured before the debounce row fires
- **THEN** the claimed row is not submitted, the denial is logged, and the debounce row is removed

#### Scenario: Cost verdict flips to denied before fire
- **WHEN** an allowed dataset write schedules a debounced auto-run and the pipeline fails the cost verdict by the time the row is claimed
- **THEN** the claimed row is not submitted and the debounce row is removed

#### Scenario: Pending row from an earlier allowed write after a later denied write
- **WHEN** an allowed write leaves a pending debounce row, the pipeline is then made misconfigured, and a later write is denied at write time
- **THEN** the pending row does not submit a run when it fires

#### Scenario: Fire-time evaluation fails
- **WHEN** the fire-time evaluation of a claimed debounce row fails with an error (including a stored step config that cannot be decoded)
- **THEN** no run is submitted, the error is logged, and the claim is released, so it is not retried in a loop

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
