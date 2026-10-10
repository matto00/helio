## ADDED Requirements

### Requirement: Lookup editor controls have per-step-unique ids
Each lookup step's editor SHALL give its "Reference match field" input an `id` that is unique on the page, and that field's `<label>` SHALL reference that id, so that when several lookup steps are expanded at once no two elements share an id and each label resolves to its own card's input.

#### Scenario: Two lookup cards expanded together
- **WHEN** two lookup step editors are rendered on the same page
- **THEN** their "Reference match field" inputs have different `id` values, no other element shares either id, and each card's "Reference match field" label is associated with that card's own input
