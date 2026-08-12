# metric-authoring-ui Specification

## Purpose
Gives humans an in-app surface to author defined metrics (create/edit/deprecate/delete, with
measure-field and dimension pickers constrained to the bound DataType) rather than only via the
agent/API, complementing the panel binding editor's bind-to-metric mode.
## Requirements
### Requirement: Metrics list page

The system SHALL provide a `/metrics` route listing the caller's defined metrics (name, bound DataType
name, measure field, aggregation, deprecated status), with loading/empty/error states matching
`PipelinesPage`'s conventions (`EmptyState` when no metrics exist, a visible error on a failed fetch,
never a blank screen). A "New metric" affordance SHALL be present on this page.

#### Scenario: Metrics list loads and displays existing metrics
- **WHEN** a user with existing metrics navigates to `/metrics`
- **THEN** the page shows a row per metric with its name, bound DataType, measure field, aggregation,
  and deprecated status

#### Scenario: Empty state when no metrics exist
- **WHEN** a user with no metrics navigates to `/metrics`
- **THEN** the page shows an `EmptyState` rather than a blank list

#### Scenario: Fetch failure shows a visible error
- **WHEN** `GET /api/metrics` fails
- **THEN** the page shows a visible error, not a blank or infinitely-loading screen

### Requirement: Metric editor supports create, edit, deprecate, and delete

The system SHALL provide a metric editor (`/metrics/:id` for edit, a "new" flow from the list page for
create) with fields: name, description, a pipeline-output DataType picker, a measure-field picker (from
the selected DataType's fields), an aggregation picker (`sum`/`avg`/`min`/`max`/`count`/
`countDistinct`), an allowed-dimensions multi-select (from the selected DataType's fields), format
(unit/decimals/prefix/suffix), and a deprecate toggle. Saving SHALL call `POST /api/metrics` (create)
or `PATCH /api/metrics/:id` (edit); a delete action SHALL call `DELETE /api/metrics/:id`.

#### Scenario: Creating a metric
- **WHEN** a user fills the metric editor's required fields (name, DataType, measure field, aggregation)
  and saves
- **THEN** `POST /api/metrics` is called and the new metric appears in the metrics list

#### Scenario: Measure-field and allowed-dimensions pickers are constrained to the selected DataType
- **WHEN** a user selects a DataType in the metric editor
- **THEN** the measure-field picker and allowed-dimensions multi-select only offer that DataType's
  declared fields

#### Scenario: Editing a metric's name
- **WHEN** a user changes an existing metric's name and saves
- **THEN** `PATCH /api/metrics/:id` is called with only the changed field, and the metric's other
  fields are unchanged

#### Scenario: Deprecating a metric
- **WHEN** a user toggles a metric's deprecate switch and saves
- **THEN** `PATCH /api/metrics/:id` is called with `deprecated: true`, and the metrics list reflects
  the deprecated status

#### Scenario: Deleting a metric
- **WHEN** a user deletes a metric from the editor or list
- **THEN** `DELETE /api/metrics/:id` is called and the metric no longer appears in the metrics list

### Requirement: Metric editor surfaces backend validation errors inline

The metric editor SHALL surface a `400` (empty name) or `422` (binding-shape: `dataTypeId` not owned/
not pipeline-output, `measureField`/an `allowedDimensions` entry not a field of the DataType,
`aggregation` not in the allowed set) response's message as a visible, field-scoped error, without
losing the user's in-progress edits.

#### Scenario: Empty name is rejected inline
- **WHEN** a user attempts to save a metric with an empty name
- **THEN** the backend's `400` message is shown inline near the name field, and the form's other
  entered values are preserved

#### Scenario: Invalid binding is rejected inline
- **WHEN** a user attempts to save a metric whose `measureField` is not a field of the selected
  DataType
- **THEN** the backend's `422` message is shown inline, and the form's other entered values are
  preserved

