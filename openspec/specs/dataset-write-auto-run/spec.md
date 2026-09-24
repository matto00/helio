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
