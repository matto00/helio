## ADDED Requirements

### Requirement: Leaving a step-config text field does not re-save an unchanged config

A step-config text input in the pipeline editor SHALL commit its value through its change events only. Moving focus
out of the field (blur) SHALL NOT emit the step's config again, so an edit followed by a blur SHALL produce exactly one
`PATCH /api/pipeline-steps/:id` for that edit, and a blur with no edit SHALL produce none. This applies at least to the
convertformat "Destination field", the compute "Output field name" and "Expression", and the upsertsource "New source
name" inputs.

#### Scenario: Edit then blur sends one save

- **WHEN** the user types a value into one of these fields on a persisted step and then moves focus elsewhere
- **THEN** exactly one `PATCH /api/pipeline-steps/:id` carrying the edited config is sent for that edit

#### Scenario: Blur without an edit sends no save

- **WHEN** the user focuses one of these fields and moves focus away without changing its value
- **THEN** no `PATCH /api/pipeline-steps/:id` is sent
