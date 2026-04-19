## Context

DataTypes currently store a `fields` JSONB column describing raw source fields. The backend serves preview rows by fetching from the backing DataSource and returning raw rows. There is no mechanism to append derived columns.

The expression evaluator must be implemented from scratch (no external parsing libraries) and must handle arithmetic, field references, and string concatenation safely.

## Goals / Non-Goals

**Goals:**
- Store computed field definitions alongside regular fields in the `data_types` table
- Evaluate expressions per-row server-side at preview time
- Surface computed fields in the API response and the frontend field picker
- Return safe, descriptive errors for invalid expressions — never crash or silently return wrong values

**Non-Goals:**
- Conditional logic, aggregations, cross-row computations
- Computed fields referencing other computed fields
- Expression evaluation at ingest/write time (evaluation is always on-read)

## Decisions

### 1. JSONB column for computed field storage
Store computed fields as a JSONB array in a new `computed_fields` column on `data_types`. Structure per entry: `{ name: String, displayName: String, expression: String, dataType: String }`.
**Rationale**: Mirrors the existing `fields` JSONB pattern in the same table. Avoids a separate join table for a small, bounded list. Consistent with how `DemoData` and `DataTypeRepository` already handle field arrays.

### 2. Server-side expression evaluator — recursive descent parser
Implement a hand-rolled recursive descent parser in Scala (`ExpressionEvaluator`). Grammar: `expr → term ((+ | -) term)*`, `term → factor ((* | /) factor)*`, `factor → NUMBER | STRING_LITERAL | FIELD_REF | ( expr )`.
**Rationale**: No external dependencies required by the ticket. A recursive descent parser is straightforward to implement, test, and reason about for the restricted grammar. Alternative (regex substitution) cannot correctly handle operator precedence or nested parens.

### 3. Evaluation at preview-row time in DataTypeRepository / service layer
Evaluate expressions inside the existing row-serving code path (wherever `GET /api/data-sources/:id/sources` rows are assembled). Append computed field results as additional key-value pairs to each row map.
**Rationale**: Keeps evaluation close to where rows are produced. Avoids a separate pass. The row map is already `Map[String, Any]`; appending is O(fields).

### 4. `computedFields` array in API request/response
Extend `DataType` case class with `computedFields: Seq[ComputedField]` (default empty). `JsonProtocols` gets a new `ComputedField` formatter. `PATCH /api/types/:id` accepts an optional `computedFields` array.
**Rationale**: Additive change — clients that don't send `computedFields` get the existing behavior. The field is optional in PATCH, matching the existing `name` / `fields` pattern.

### 5. Frontend: controlled form inside TypeDetailPanel
Add a `ComputedFieldsEditor` component (local state, not Redux) inside `TypeDetailPanel`. On save, the updated `computedFields` array is included in the existing PATCH thunk payload alongside `fields`.
**Rationale**: Computed fields are edited only in `TypeDetailPanel`; no cross-component sharing needed. Local component state is sufficient — Redux is for shared application state per CLAUDE.md.

### 6. Inline expression validation
On blur/change in the expression input, call `GET /api/types/:id/validate-expression?expr=...` (or validate client-side with a lightweight JS mirror of the parser rules). Backend returns 400 with a `message` field on invalid expressions.
**Decision**: Validate on the backend via a thin validation endpoint to avoid duplicating parser logic in JS. The existing `shared-inline-error` pattern is used to display errors.

## Risks / Trade-offs

- [Division by zero at runtime] → Evaluator catches and returns a descriptive error string; the row value is set to `null` and the API returns the error detail in a top-level `evaluationErrors` array rather than 500.
- [Expression injection / DoS] → The parser only recognizes the defined grammar; unknown tokens are rejected. No `eval` or reflection used.
- [Large computed field expressions] → No explicit length limit defined; impose a 500-char cap in `RequestValidation` to prevent abuse.

## Migration Plan

1. Add Flyway migration `V<next>__add_computed_fields_to_data_types.sql` — `ALTER TABLE data_types ADD COLUMN computed_fields JSONB NOT NULL DEFAULT '[]'`.
2. Existing rows get an empty array automatically — no data migration needed.
3. Rollback: `ALTER TABLE data_types DROP COLUMN computed_fields` (safe, no FKs).

## Planner Notes

- Self-approved: expression evaluator complexity is well-scoped, no new external dependencies, purely additive API changes.
- The validate-expression endpoint is a new route; it does not appear in the existing spec. Adding to `datatype-crud-api` modified capabilities.
