## MODIFIED Requirements

### Requirement: Schedule bar shows current schedule state
The pipeline detail page's single header region SHALL show the schedule summary, compactly, on
one line, alongside the bound-source and bound-type information: "No schedule set" when the
pipeline has no schedule, or the schedule's kind/expression, enabled state, and next-run time
(formatted as a local date/time) when one exists. The corresponding action — "Set schedule" when
no schedule exists, "Edit schedule" when one does — SHALL be available as an item in the header's
single actions menu (see `pipeline-editor-page`'s "Header actions consolidate into one menu"
requirement), not as its own always-visible button.

#### Scenario: No schedule set
- **WHEN** `GET /api/pipelines/:id/schedule` resolves to no schedule (404)
- **THEN** the page header shows "No schedule set", the header's actions menu offers "Set
  schedule", and no next-run time is displayed

#### Scenario: Schedule exists and is enabled
- **WHEN** the pipeline has a schedule with `enabled: true` and a non-null `nextRunAt`
- **THEN** the page header shows the schedule's expression and the next-run time

#### Scenario: Schedule exists but has no computed next run yet
- **WHEN** the pipeline has a schedule with `enabled: true` and `nextRunAt: null`
- **THEN** the page header shows the schedule's expression without a next-run time, and does not
  render an error

### Requirement: User can set a new schedule
The user SHALL be able to open a schedule dialog and create a schedule for a pipeline with no
existing schedule by choosing a kind (interval or cron), entering an expression, choosing a
timezone, and saving. On save, the frontend SHALL call `PUT /api/pipelines/:id/schedule`.

#### Scenario: Interval schedule created via friendly picker
- **WHEN** the user selects kind "interval", enters a number and unit (e.g. 15 / minutes), and
  saves
- **THEN** `PUT /api/pipelines/:id/schedule` is called with `expression: "15m"` and the header's
  schedule section reflects the new schedule after the call resolves

#### Scenario: Cron schedule created
- **WHEN** the user selects kind "cron", enters a 5-field cron expression, and saves
- **THEN** `PUT /api/pipelines/:id/schedule` is called with that expression and the header's
  schedule section reflects the new schedule after the call resolves

### Requirement: User can edit an existing schedule
The user SHALL be able to open the schedule dialog for an existing schedule pre-filled with its
current kind, expression, enabled state, and timezone, change any field, and save via
`PUT /api/pipelines/:id/schedule`.

#### Scenario: Editing an existing schedule pre-fills the form
- **WHEN** the user opens the schedule dialog for a pipeline with an existing schedule
- **THEN** the kind, expression, enabled toggle, and timezone fields are pre-filled with the
  schedule's current values

#### Scenario: Saving an edit persists the change
- **WHEN** the user changes the expression and saves
- **THEN** `PUT /api/pipelines/:id/schedule` is called with the updated fields and the header's
  schedule section reflects the new expression after the call resolves

### Requirement: User can enable or disable a schedule
The page header and the schedule dialog SHALL each provide a way to toggle `enabled` without
altering the `kind`/`expression`/`timezone` fields, persisted via
`PUT /api/pipelines/:id/schedule`.

#### Scenario: Disabling from the header
- **WHEN** the user toggles the enabled control in the page header's schedule section
- **THEN** `PUT /api/pipelines/:id/schedule` is called with `enabled: false` and the same
  `kind`/`expression`/`timezone` as before

### Requirement: User can clear a schedule
The schedule dialog SHALL provide a "Clear schedule" action that calls
`DELETE /api/pipelines/:id/schedule`. After a successful delete, the page header's schedule
section SHALL return to the "No schedule set" state.

#### Scenario: Clearing an existing schedule
- **WHEN** the user clicks "Clear schedule" in the dialog for a pipeline with an existing schedule
- **THEN** `DELETE /api/pipelines/:id/schedule` is called and, after it resolves, the page header
  shows "No schedule set"

### Requirement: Backward compatible — no schedule renders as today
Pipelines without a schedule SHALL render the pipeline editor's header and footer regions exactly
as they render for a pipeline with a schedule, aside from the schedule section itself showing
"No schedule set" instead of an expression/next-run summary.

#### Scenario: Existing editor layout unaffected
- **WHEN** a pipeline with no schedule is opened in the editor
- **THEN** the single header region, river view, and single footer region render exactly as they
  would for a pipeline with a schedule, and the header's schedule section shows only
  "No schedule set", with "Set schedule" available as an item in the header's actions menu
