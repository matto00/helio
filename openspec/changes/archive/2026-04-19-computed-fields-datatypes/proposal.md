## Why

DataType fields are currently sourced only from raw ingest data. Users cannot derive new values from existing fields (e.g. `total = price * quantity`), forcing them to pre-compute derived columns upstream before ingesting. Computed fields eliminate this gap by letting users define expressions evaluated at query time.

## What Changes

- Add a `computed_fields` JSONB column to `data_types` (Flyway migration)
- Implement a server-side expression evaluator: arithmetic (`+`, `-`, `*`, `/`), field references by name, string concatenation — no external libraries
- Computed fields are evaluated per-row when serving preview or data rows; results are appended to each row
- `GET /api/types/:id` and `PATCH /api/types/:id` return computed fields alongside regular fields
- Invalid expressions (parse error, division by zero, unknown field reference) return 400 with a descriptive error
- `TypeDetailPanel` gains a "Computed fields" section: add / edit / remove entries (name, display name, expression, output type)
- Inline expression validation shown before save

## Capabilities

### New Capabilities

- `datatype-computed-fields`: Backend storage, evaluation, and API surface for computed fields on DataTypes
- `frontend-computed-fields-editor`: UI in TypeDetailPanel for managing computed field definitions

### Modified Capabilities

- `datatype-crud-api`: `GET /api/types/:id` and `PATCH /api/types/:id` now include a `computedFields` array in the response; `PATCH` accepts an optional `computedFields` array
- `panel-bound-data-fetch`: Preview rows now include computed field values; the field picker must surface computed fields alongside regular fields

## Impact

- **Backend**: `DataTypeRepository`, `DataTypeRoutes`, `JsonProtocols`, new `ExpressionEvaluator` utility, new Flyway migration
- **Frontend**: `typesSlice`, `TypeDetailPanel`, `useDataFetch` or equivalent hook, field-picker component
- **Schema**: `data-type.json` schema extended with `computedFields` array
- **No breaking changes** — `computedFields` is additive; existing DataTypes return an empty array

## Non-goals

- Conditional logic (if/else, ternary)
- Aggregations or cross-row computations
- Computed fields referencing other computed fields
