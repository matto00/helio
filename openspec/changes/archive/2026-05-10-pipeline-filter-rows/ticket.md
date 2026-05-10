# HEL-190 — Pipeline operation: Filter rows

**Status**: In Progress
**Priority**: High
**Parent**: HEL-141 (v1 pipeline operations epic)
**Project**: Helio v1.3 — Data Pipeline & Registry Hardening

## Description

Step type: keep only rows matching a condition (field / operator / value).
Supported operators: =, !=, >, >=, <, <=, contains, is null, is not null.
Multiple conditions combinable with AND/OR.

## Context

This is the fourth of 8 v1 pipeline operations. Three preceding ops have shipped:
- HEL-187 Select — `{"fields":[]}`
- HEL-188 Rename — `{"renames":{}}`
- HEL-189 Cast — `{"casts":{}}`

### Config Shape Mismatch (CRITICAL)

The existing `applyFilter` in `InProcessPipelineEngine` uses the old expression-evaluator
config shape: `{"expression": "age"}`. The analyze service treats filter as identity (no
config parsing). Both must be migrated to the canonical structured shape:

```json
{"combinator": "AND", "conditions": []}
```

The existing `applyFilter` and its single test ("keeps rows where expression evaluates to
non-zero number") must be replaced entirely.

### Canonical Config Shape (to implement)

```json
{
  "combinator": "AND",
  "conditions": [
    { "field": "age", "operator": ">=", "value": "18" },
    { "field": "status", "operator": "is null" }
  ]
}
```

- `combinator`: "AND" | "OR" — applies across all conditions
- `conditions`: array of condition objects
  - `field`: field name from inputSchema
  - `operator`: one of `=`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `is null`, `is not null`
  - `value`: string (absent/omitted for unary operators `is null`, `is not null`)

### Precedents

- `PipelineAnalyzeService.inferFilter` — already treats filter as identity (correct for
  structured conditions: schema is unchanged by filter)
- `PipelineDetailPage.tsx` — filter op is in OP_TYPES already but falls to the generic
  placeholder branch; needs a `FilterConfig` component wired in
- `StepCard` in `PipelineDetailPage.tsx` — pattern for Select/Rename/Cast: parse config
  in parent, pass derived state to child component, handle change events with PATCH

### Frontend analyze data

`useAnalyzePipeline` / `analyzeResult` per step exposes `inputSchema: SchemaField[]` with
`{name, type}`. The `FilterConfig` component receives `analyzeStep.inputSchema` (not just
field names) so the value input can adapt to field type.

## Acceptance Criteria

1. Backend `applyFilter` rewritten to evaluate structured conditions with all 9 operators
2. Unary operators (`is null`, `is not null`) work without a value
3. `contains` operator works on string fields
4. Numeric comparisons (`>`, `>=`, `<`, `<=`) coerce value string to Double for comparison
5. AND combinator: all conditions must pass
6. OR combinator: at least one condition must pass
7. Missing field treated as null (passes `is null`, fails all comparisons)
8. Empty conditions array passes all rows (no-op)
9. Backend unit tests: each operator, AND/OR, missing field, empty conditions
10. Frontend `FilterConfig` component: rows of (field dropdown | operator dropdown | value input)
11. Top-level AND/OR toggle
12. Value input hidden for unary operators
13. Field options from analyze inputSchema; value input type-aware (number input for numeric fields)
14. Initial config seeded as `{"combinator":"AND","conditions":[]}` on step creation
15. Config hydrated from persisted step on page reload
16. Config persisted via `updatePipelineStep` using real backend step ID
17. Frontend component tests: renders conditions, adds/removes, AND/OR toggle, type-aware input
