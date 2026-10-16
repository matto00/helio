# pipeline-context-details-read Specification

## Purpose
A single authenticated read that returns, for every pipeline visible to the caller, the step list and the latest
run's assertion summary, so a client can ground on every pipeline without one request per pipeline.

## Requirements

### Requirement: Batched pipeline context details read
The backend SHALL serve `GET /api/pipelines/context-details` to an authenticated caller (session or PAT). The
response SHALL be `{ "items": [...] }` with exactly one item per pipeline id that `GET /api/pipelines` (no `tag`)
returns for the same caller, in the same order, and no other pipelines. Each item SHALL carry `pipelineId`, `steps`
and, when the pipeline has at least one persisted run, `latestRunAssertions`.

#### Scenario: Items match the caller's pipeline list
- **WHEN** a caller who owns two pipelines and holds a viewer grant on a third calls the read
- **THEN** the response has two items whose `pipelineId`s equal, in order, the ids `GET /api/pipelines` returns
  (owner-scoped), and the viewer-granted pipeline is absent from both

#### Scenario: Pipeline with no steps
- **WHEN** the caller owns a pipeline with zero steps
- **THEN** its item is present with `steps: []`

#### Scenario: Unauthenticated caller
- **WHEN** the read is called with no valid credential
- **THEN** it responds `401`, like `GET /api/pipelines`

### Requirement: Another user's pipelines are never returned
The read SHALL NOT include, in any field, a pipeline, step or assertion belonging to a pipeline the caller cannot
read through `GET /api/pipelines`. This SHALL hold when the backend runs on a role that does not bypass row-level
security, not only as a superuser.

#### Scenario: Two users, RLS-enforced role
- **WHEN** user A and user B each own pipelines with steps and runs, and B calls the read over a non-BYPASSRLS pool
- **THEN** no item, step id or assertion of A's pipelines appears in B's response

### Requirement: Steps match the per-pipeline steps read
Each item's `steps` SHALL equal, element for element and field for field, the body of
`GET /api/pipelines/:id/steps` for that pipeline and caller.

#### Scenario: Branched pipeline
- **WHEN** a pipeline has two roots and a branch step with a `parentStepId`
- **THEN** its item's `steps` deep-equals that pipeline's `GET /api/pipelines/:id/steps` body

### Requirement: Latest run assertions match run history
`latestRunAssertions` SHALL equal the `assertions` of the first entry of `GET /api/pipelines/:id/run-history`
(most recent `startedAt`, any status, dry or real). It SHALL be omitted when that history is empty.

#### Scenario: Pipeline with runs
- **WHEN** a pipeline has an older run with a failed assertion and a newer run with at least two failed assertions
- **THEN** `latestRunAssertions` equals the newer run's summary, `failures` in the same order as run history

#### Scenario: Pipeline never run
- **WHEN** a pipeline has no runs
- **THEN** its item has no `latestRunAssertions` key

### Requirement: Additive only
Adding the read SHALL NOT change the status, body or headers of any existing route.

#### Scenario: Existing per-pipeline routes unchanged
- **WHEN** `GET /api/pipelines/:id`, `/steps` and `/run-history` are called after the change
- **THEN** they return the same bodies as before the change
