## 1. Backend

- [x] 1.1 Add Flyway migration: `ALTER TABLE data_types ADD COLUMN computed_fields JSONB NOT NULL DEFAULT '[]'`
- [x] 1.2 Add `ComputedField` case class (`name`, `displayName`, `expression`, `dataType`) and extend `DataType` with `computedFields: Seq[ComputedField]`
- [x] 1.3 Add `ComputedField` and updated `DataType` JSON formatters in `JsonProtocols`
- [x] 1.4 Update `DataTypeRepository`: read/write `computed_fields` column in all relevant queries
- [x] 1.5 Implement `ExpressionEvaluator`: recursive descent parser supporting arithmetic, field references, string concatenation, and parentheses
- [x] 1.6 `ExpressionEvaluator.validate(expr, fieldNames)`: return `Right(())` or `Left(message)` without evaluating
- [x] 1.7 `ExpressionEvaluator.evaluate(expr, row)`: return value or `EvaluationError` (division by zero, unknown field, parse error)
- [x] 1.8 Apply computed field evaluation in the row-serving code path (append computed values to each row map)
- [x] 1.9 Reject `PATCH /api/types/:id` with 400 if any `computedFields` expression fails `validate`; validate expression length <= 500 chars in `RequestValidation`
- [x] 1.10 Add `GET /api/types/:id/validate-expression?expr=` route in `DataTypeRoutes` / `ApiRoutes`

## 2. Frontend

- [x] 2.1 Extend TypeScript `DataType` type with `computedFields: ComputedField[]` and add `ComputedField` interface
- [x] 2.2 Update `typesSlice` thunks / API service to send and receive `computedFields`
- [x] 2.3 Add `validateExpression(typeId, expr)` service function calling `GET /api/types/:id/validate-expression`
- [x] 2.4 Build `ComputedFieldsEditor` component: list existing fields with edit/remove controls and "Add" button
- [x] 2.5 Build `ComputedFieldForm` component: name, displayName, expression (with on-blur validation), outputType selector
- [x] 2.6 Wire `ComputedFieldsEditor` into `TypeDetailPanel` below the regular fields section
- [x] 2.7 Include `computedFields` in the PATCH payload dispatched from `TypeDetailPanel` on save
- [x] 2.8 Display computed fields in the field picker with a "computed" badge/label

## 3. Tests

- [x] 3.1 Unit tests for `ExpressionEvaluator`: arithmetic, string concat, field reference, division by zero, unknown field, parse errors, nested parens
- [x] 3.2 Backend integration tests: `PATCH` with valid `computedFields`, `PATCH` with invalid expression returns 400, `GET /api/types/:id` includes `computedFields`
- [x] 3.3 Backend integration test: `GET /api/types/:id/validate-expression` — valid, syntax error, unknown field, type not found
- [x] 3.4 Frontend unit tests for `ComputedFieldsEditor`: add, edit, remove, inline validation error shown/cleared
- [x] 3.5 Frontend unit test: computed fields appear in field picker with "computed" label
