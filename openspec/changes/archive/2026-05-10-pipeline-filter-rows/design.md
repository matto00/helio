## Context

Three pipeline ops (Select/HEL-187, Rename/HEL-188, Cast/HEL-189) established the config-shape pattern:
each op stores a typed JSON blob, `InProcessPipelineEngine` applies it, and `PipelineAnalyzeService`
infers the output schema. Filter already exists in `applyStep`'s match arms but uses a legacy
`{"expression":"..."}` shape tied to `ExpressionEvaluator`. `PipelineAnalyzeService.inferFilter` is
already a correct identity (filter doesn't change schema). One test exercises the old expression shape.

The `StepCard` in `PipelineDetailPage.tsx` dispatches to `FilterConfig` for op `"filter"` but currently
falls to a generic placeholder. The same pattern used for Cast/Rename/Select applies here.

## Goals / Non-Goals

**Goals:**
- Replace expression-based `applyFilter` with structured multi-condition evaluation
- 9 operators: `=`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `is null`, `is not null`
- Top-level AND/OR combinator across conditions
- `FilterConfig` React component with dynamic rows (field | operator | value)
- Value input adapts to field type (number input for numeric types)
- Persist via `updatePipelineStep` on every change; hydrate on reload

**Non-Goals:** nested groups, date-aware comparison, Spark pushdown, analyze validation errors for filter

## Decisions

### Config shape: structured conditions object (not expression string)

Chosen: `{"combinator":"AND","conditions":[{"field":"age","operator":">=","value":"18"}]}`.
Alternative was keeping the expression evaluator. Rejected: expressions are not UI-constructable
without a full expression parser. The structured shape maps 1:1 to the FilterConfig UI rows and is
consistent with the Select/Rename/Cast pattern of typed JSON configs.

The `value` field is always a string on the wire; the backend coerces to numeric when needed (mirrors
how Cast uses string target-type identifiers).

### Unary operator handling: value absent, not empty string

For `is null` and `is not null`, the condition object omits `value` entirely. The frontend sends
`{field:"x", operator:"is null"}` with no `value` key. The backend reads `value` optionally and
ignores it for unary operators. This avoids ambiguity between "no value provided" and "empty string value".

### Frontend value input: type-aware but non-blocking

The `FilterConfig` component receives `analyzeSchema: SchemaField[]` (not just `columns: string[]`)
so it can look up the field's `type`. For `number`, `integer`, `long`, `double`, `float` it renders
`<input type="number">`. For all other types it renders `<input type="text">`. Empty value rows are
valid (condition is skipped server-side if field is empty — no field selected means no-op condition).

### applyFilter: treat missing field as null, empty conditions as pass-all

Missing field in a row → treated as null (matches `is null`, fails all comparisons).
Empty conditions array → returns all rows (no-op). This is consistent with how `applySelect` with
empty fields returns empty-mapped rows — the degenerate case is well-defined.

### Initial seed config: `{"combinator":"AND","conditions":[]}`

Mirrors the pattern from Cast (`{"casts":{}}`), Rename (`{"renames":{}}`), Select (`{"fields":[]}`).
This is a valid no-op: all rows pass, schema unchanged. `PipelineAnalyzeService.inferFilter` already
handles any config (identity), so no parse change is needed there.

### Test replacement: old expression-based filter test removed

The single existing test `"filter: keeps rows where expression evaluates to non-zero number"` tests
the old contract. It is replaced by 9+ structured-condition tests. The broader test fixture
(sampleRows: alice/30/eng, bob/25/mkt, carol/0/eng) is reused.

## Risks / Trade-offs

- [Type coercion for `>`, `>=`, `<`, `<=`] If the field value is non-numeric and operator is numeric,
  coercion will silently fail → treat as no-match (row excluded). Mitigation: documented in code.
- [contains on non-string values] `contains` uses `.toString` on the field value before checking.
  Mitigation: acceptable for v1; Cast step upstream can normalize types.
- [Empty `field` key in condition] If conditions contain `{field:"", operator:"=", value:"x"}`, the
  filter would compare against a missing field (treated as null, result: excluded). Mitigation: the
  frontend only populates `field` from the analyze schema dropdown, so empty field only occurs if no
  schema is available yet — those conditions are skipped (backend checks `field.nonEmpty`).

## Planner Notes

- Self-approved: structured conditions over expression evaluator — no architectural ambiguity.
- Self-approved: `analyzeSchema: SchemaField[]` prop on `FilterConfig` (vs. just column names) — needed
  for type-aware value input; consistent with how the analyze endpoint already exposes types.
- Self-approved: unary operators omit `value` key — cleaner than empty-string sentinel.
- No migration needed: the old expression-based filter was only used in one test and has no
  persisted data in production (feature was never enabled in the UI).
