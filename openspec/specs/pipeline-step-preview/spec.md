# pipeline-step-preview Specification

## Purpose
TBD - created by archiving change step-preview-ui. Update Purpose after archive.

## Requirements

### Requirement: GET /api/pipelines/:id/steps/:stepId/preview returns sample rows up to a step
The backend SHALL expose `GET /api/pipelines/:id/steps/:stepId/preview`. The endpoint SHALL:
- Fetch all steps for the pipeline in the repository's execution order
- Find the step with `id == stepId`
- Build the target step's **transitive dependency closure**: the target, every ancestor reachable by `parentStepId`,
  and — for every `join`/`union`/`lookup` step already in the closure whose `secondaryInput` is `{kind:"lane", stepId}` —
  that referenced node together with its own ancestors, repeated to a fixed point. The closure SHALL NOT be a
  positional prefix `0..K`, which folds unrelated lanes in and omits referenced ones
- Execute that closure against the pipeline's root DataSource(s) using the in-process engine, leaving evaluation
  ORDER to the engine's own topological walk rather than imposing a second ordering
- Return the first 10 rows of the target node's own frame as `{ rows: [...], rowCount: N }` where `rowCount` is
  the total number of rows produced (not capped at 10)
- Pass the pipeline's FULL set of roots to the engine, never narrowed to the target's own root: a lane reference is
  validated pipeline-scoped and not root-scoped, so a closure MAY legally span two roots, and narrowing trips the
  engine's single-root shortcut, which remaps the foreign root's lane step onto the surviving root and evaluates it
  against the wrong frame — returning 200 with wrong rows rather than failing
- Read the returned rows from the target node's own retained frame, not from the walk's terminal frame
- Report `stepCounts` covering EVERY node in the executed closure, including the steps of a referenced secondary lane —
  those nodes genuinely executed, and omitting them would report a rejoin as produced from inputs the response claims
  never ran
- Return `200 OK` on success
- Return `404 Not Found` if the pipeline or step is not found
- Return `422 Unprocessable Entity` if the source type is unsupported (RestApi, Sql)

#### Scenario: Returns first 10 rows for a valid step
- **WHEN** `GET /api/pipelines/:id/steps/:stepId/preview` is called for a pipeline with a static
  data source and a select step at the root
- **THEN** the response is `200 OK` with a `rows` array containing at most 10 rows and a
  `rowCount` field equal to the total number of rows produced after applying that step

#### Scenario: Steps after the target step are not applied
- **WHEN** a pipeline has a select step followed by a limit step as its child,
  and preview is requested for the select step
- **THEN** the response rows reflect only the select step applied; the limit step is not applied

#### Scenario: Previewing a rejoin whose secondary lane is not an ancestor
- **WHEN** preview is requested for a `join` step whose `secondaryInput` is `{kind:"lane", stepId}` naming the
  terminal step of a SIBLING lane that is not among the join's own `parentStepId` ancestors
- **THEN** the response is `200 OK` and the returned rows are the joined result of both lanes — field-for-field
  identical to the rows the real `/run` path materializes for that same node on the same fixture

#### Scenario: Previewing a rejoin whose secondary lane sits under a different root
- **WHEN** preview is requested for a rejoin under one root whose `secondaryInput` is `{kind:"lane", stepId}` naming a
  step under a DIFFERENT root of the same pipeline, the two roots carrying distinguishable source data
- **THEN** the response is `200 OK` and the rows equal what the real `/run` path materializes for that node — in
  particular the referenced lane is evaluated against ITS OWN root's frame, not the target's root's frame

#### Scenario: A rejoin preview reports counts for the referenced lane's steps
- **WHEN** preview is requested for a rejoin consuming a secondary lane
- **THEN** `stepCounts` contains an entry for each step of that secondary lane, alongside the target's own chain

#### Scenario: Sibling lanes not referenced by the target are excluded
- **WHEN** a pipeline has two sibling lanes and preview is requested for the terminal step of one lane, which holds
  no lane reference
- **THEN** the other lane's steps are absent from the executed closure, and the rows reflect only the target's own lane

#### Scenario: A lane consumed by two rejoins is executed once
- **WHEN** preview is requested for a rejoin in a diamond graph where one lane is referenced by more than one rejoin
- **THEN** the executed closure contains each step exactly once, and the call returns `200 OK`

#### Scenario: A graph with no lane reference previews exactly as before
- **WHEN** preview is requested for a step on a pure trunk, or on a trunk-plus-tails graph containing no
  `{kind:"lane"}` secondary input
- **THEN** the returned rows and `rowCount` are byte-identical to the pre-change behaviour

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `GET /api/pipelines/nonexistent/steps/any-step-id/preview` is called
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 404 for unknown step
- **WHEN** `GET /api/pipelines/:id/steps/nonexistent-step-id/preview` is called with a valid pipeline
- **THEN** the response is `404 Not Found`

#### Scenario: Returns 422 for unsupported source type
- **WHEN** the pipeline's source DataSource has type `rest_api` or `sql`
- **THEN** the response is `422 Unprocessable Entity` with a descriptive error message

### Requirement: StepCard Preview button fetches and renders sample rows
The frontend StepCard component SHALL:
- When the preview is active (expanded card with the preview open), call
  `GET /api/pipelines/:id/steps/:stepId/preview` and render the sample rows (up to 10) in the
  shared `DataGrid` preview variant below the config editor, inside the expanded step card body
- Render the step's output schema (column name + type) alongside the sample rows, sourced
  client-side from the analyze endpoint's per-step `outputSchema` (no new backend call)
- Omit the schema display (rows still render) when analyze data for the step is unavailable
- Show a loading indicator while the preview request is in flight
- On error, show an inline error message
- Toggling the preview control SHALL hide the preview (toggle behavior)
- Persist the open/closed preview preference per user (localStorage), so a user who left the
  preview open gets an auto-opened preview on subsequently expanded step cards
- Re-fetch the preview rows automatically, debounced, after the step's persisted config changes
  **or the step's position in the editor's step list changes (reorder)** while the preview is
  active — without requiring a manual close/reopen or a full pipeline run

#### Scenario: Preview shows sample rows and output schema together
- **WHEN** the user activates the preview on an expanded StepCard for a pipeline with static data
  and analyze data is available for that step
- **THEN** a table of up to 10 rows appears below the config editor together with the step's
  output schema listing each column name and type

#### Scenario: Schema display is omitted when analyze data is unavailable
- **WHEN** the preview is active but the analyze result has no entry for the step (pending,
  failed, or unknown step id)
- **THEN** the sample rows render without a schema display and no error is shown for the
  missing schema

#### Scenario: Preview refreshes after a config edit settles
- **WHEN** the preview is active and the user edits the step's config such that a PATCH persists
  a new config
- **THEN** the preview rows re-fetch automatically after a debounce interval, without the user
  toggling the preview or running the pipeline

#### Scenario: Preview refreshes after a reorder
- **WHEN** the preview is active on a step and the step's position in the step list changes via
  a reorder
- **THEN** the preview rows re-fetch automatically after a debounce interval, reflecting the
  step's new upstream prefix

#### Scenario: Closed preview does not refresh on config edits
- **WHEN** the preview is closed and the user edits the step's config
- **THEN** no preview request is issued

#### Scenario: Preview open state persists as a user preference
- **WHEN** the user opens the preview on one step card and later expands another step card (or
  reloads the editor)
- **THEN** the preview auto-opens on the newly expanded card, and after the user hides the
  preview, subsequently expanded cards default to closed

#### Scenario: Preview loading state is shown
- **WHEN** the preview request is in flight
- **THEN** a "Loading preview..." text is shown in place of the table

#### Scenario: Preview error state is shown
- **WHEN** the preview request fails (e.g. network error or 422)
- **THEN** an inline error message is shown instead of the table

#### Scenario: Second toggle hides the preview
- **WHEN** the preview is visible and the user toggles the preview control again
- **THEN** the preview is hidden and the control reflects the collapsed state

### Requirement: Previewing a step whose closure has invalid step configuration returns a named 422
When a step preview (`GET /api/pipelines/:id/steps/:stepId/preview`) or an Output preview
(`POST /api/pipelines/:id/preview`) fails because a step in the executed closure has missing, empty or invalid
step configuration, the endpoint SHALL refuse the preview with `422 Unprocessable Entity` and SHALL NOT return an empty
row set as though the step produced no rows. The body SHALL carry the existing `message` field unchanged, plus
`code` equal to `"STEP_CONFIG_INVALID"`, `stepId` and `stepKind` of the failing step, and `reason`, the step's own
problem description without any step id or lane-path prefix. A step-configuration problem is a step kind's
required-configuration check or an invalid configuration value detected while the step evaluates. Failures caused by
the data (for example no parsable timestamps), by an unresolved lane or source reference, or by an external provider
are NOT step-configuration problems and SHALL keep their existing status and body.

#### Scenario: upsertsource with an empty new-source name
- **GIVEN** a saved `upsertsource` step whose target is `{kind: "newSource", name: ""}`
- **WHEN** that step is previewed
- **THEN** the response is 422 with `code` `"STEP_CONFIG_INVALID"`, that step's `stepId`, `stepKind`
  `"upsertsource"`, and `reason` `'upsertsource' step requires a non-empty 'target.name' for a new source`

#### Scenario: upsertsource with an absent new-source name
- **WHEN** an `upsertsource` step config whose target is `{kind: "newSource"}` with no `name` field is submitted to
  the step create endpoint
- **THEN** it is rejected with 422 naming the missing `name`, and no ERROR-level log event is emitted
- **AND WHEN** such a config is nevertheless already stored and the step is previewed
- **THEN** the step listing still loads and the preview response is the named 422 with `reason`
  `'upsertsource' step requires a non-empty 'target.name' for a new source`

#### Scenario: The failing step is an ancestor of the previewed step
- **GIVEN** a `compute` step with an empty `column` and a child `select` step
- **WHEN** the child step is previewed
- **THEN** the response is the named 422 whose `stepId` is the compute step's id, not the previewed step's

#### Scenario: A data failure is not reported as a configuration problem
- **GIVEN** a saved `datebucket` step whose field holds no parsable dates
- **WHEN** it is previewed
- **THEN** the response is 422 without `code` `"STEP_CONFIG_INVALID"`, as before

#### Scenario: A step-config failure raised during evaluation
- **GIVEN** a saved `fillnull` step with strategy `constant` and no `value`
- **WHEN** it is previewed
- **THEN** the response is the named 422 with `stepKind` `"fillnull"`

### Requirement: The step card preview tray shows the named reason
When a step preview fails with `code` `"STEP_CONFIG_INVALID"`, the StepCard preview tray SHALL render the `reason`
inline, without the step id or lane path. When `stepId` names a different (upstream) step, the tray SHALL say that an
upstream step of kind `stepKind` is not fully configured, followed by the reason. Other preview errors SHALL keep
their existing rendering.

#### Scenario: Own step incomplete
- **WHEN** the preview of a step fails with `STEP_CONFIG_INVALID` naming that same step
- **THEN** the tray shows the reason text and no UUID

#### Scenario: Upstream step incomplete
- **WHEN** the preview fails with `STEP_CONFIG_INVALID` naming an ancestor step
- **THEN** the tray attributes the problem to the upstream step's kind and shows the reason
