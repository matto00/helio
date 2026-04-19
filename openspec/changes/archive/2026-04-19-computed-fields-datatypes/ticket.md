# HEL-58: Computed fields on DataTypes

## Context

HEL-29 listed "computed fields" as part of the advanced DataType config. Currently DataType fields are all sourced directly from the raw data — there is no way to derive a new field from existing ones (e.g. `total = price * quantity`). This ticket adds that capability.

## What changes

### Backend

* Add a `computed_fields` JSONB column to the `data_types` table (new Flyway migration). Each entry: `{ name, displayName, expression, dataType }`.
* When serving preview or data rows, evaluate each computed field's expression against the row and append the result. Implement a simple expression evaluator supporting: arithmetic operators (`+`, `-`, `*`, `/`), field references by name, and string concatenation. No external libraries required.
* Return computed fields alongside regular fields in `GET /api/types/:id` and `PATCH /api/types/:id`.
* Invalid expressions (parse error, division by zero, unknown field reference) return a descriptive error and do not crash.

### Frontend

* In `TypeDetailPanel`, add a "Computed fields" section below the regular fields list.
* Allow adding a computed field: name, display name, expression input, output type selector (string / integer / float / boolean).
* Allow editing and removing existing computed fields.
* Show an inline validation error for invalid expressions before saving.

## Out of scope

* Conditional logic (`if`/`else`, ternary)
* Aggregations or cross-row computations
* Computed fields referencing other computed fields

## Acceptance criteria

- [ ] User can add a computed field with a valid arithmetic expression (e.g. `price * quantity`) on a DataType
- [ ] Computed field appears in the TypeDetailPanel field list alongside regular fields with a distinguishing label
- [ ] Preview rows returned by the backend include the computed field value
- [ ] Panels bound to the DataType can map the computed field to a display slot (it appears in the field picker)
- [ ] An invalid expression (e.g. referencing a non-existent field) shows an inline error in the UI and returns a 400 from the backend — it does not crash or produce a silent wrong value
