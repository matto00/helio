## MODIFIED Requirements

### Requirement: Metric editor supports create, edit, deprecate, and delete, with live usage-aware delete confirmation

The system SHALL provide a metric editor (`/metrics/:id` for edit, a "new" flow from the list page for
create) with fields: name, description, a pipeline-output DataType picker, a measure-field picker (from
the selected DataType's fields), an aggregation picker (`sum`/`avg`/`min`/`max`/`count`/
`countDistinct`), an allowed-dimensions multi-select (from the selected DataType's fields), format
(unit/decimals/prefix/suffix), and a deprecate toggle. Saving SHALL call `POST /api/metrics` (create)
or `PATCH /api/metrics/:id` (edit); a delete action SHALL call `GET /api/metrics/:id/usage` when
initiated, displaying the returned bound-panel count in the confirmation affordance before the user
confirms, then call `DELETE /api/metrics/:id` on confirmation.

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

#### Scenario: Deleting a metric shows the real bound-panel count before confirming
- **WHEN** a user initiates deleting a metric that two panels are bound to
- **THEN** the confirmation affordance calls `GET /api/metrics/:id/usage` and displays "2" as the
  bound-panel count, replacing any generic placeholder copy

#### Scenario: Deleting an unbound metric shows zero
- **WHEN** a user initiates deleting a metric no panel is bound to
- **THEN** the confirmation affordance displays a bound-panel count of 0

#### Scenario: Confirming delete removes the metric
- **WHEN** a user confirms deleting a metric after seeing its bound-panel count
- **THEN** `DELETE /api/metrics/:id` is called and the metric no longer appears in the metrics list
