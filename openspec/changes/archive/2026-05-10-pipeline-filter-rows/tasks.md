## 1. Backend

- [x] 1.1 Replace `applyFilter` in `InProcessPipelineEngine.scala` with structured-condition evaluation supporting all 9 operators and AND/OR combinator
- [x] 1.2 Handle unary operators (`is null`, `is not null`) — `value` key absent/ignored
- [x] 1.3 Handle numeric coercion for `>`, `>=`, `<`, `<=` — field and value both parsed as Double; coercion failure → no-match
- [x] 1.4 Handle `contains` — call `.toString` on field value then check substring
- [x] 1.5 Treat missing field as null; empty conditions array passes all rows; skip conditions with empty `field`

## 2. Frontend

- [x] 2.1 Create `FilterConfig.tsx` — renders combinator toggle (AND/OR) and a list of condition rows
- [x] 2.2 Each condition row: field dropdown (from `analyzeSchema`), operator dropdown (9 options), value input (hidden for unary operators)
- [x] 2.3 Value input adapts to field type: `type="number"` for numeric types, `type="text"` otherwise
- [x] 2.4 "Add condition" button appends a blank row; each row has a remove button
- [x] 2.5 `FilterConfig` calls `onChange(newConfig: string)` whenever combinator or any condition changes
- [x] 2.6 In `PipelineDetailPage.tsx`: add `parseFilterConfig` helper and `filterConfig` / `setFilterConfig` state in `StepCard`
- [x] 2.7 In `StepCard`: wire `FilterConfig` for `op === "filter"` (replace generic placeholder)
- [x] 2.8 In `handleAddStep`: seed filter config as `'{"combinator":"AND","conditions":[]}'`
- [x] 2.9 In `handleFilterChange`: call `updatePipelineStep` with new config and `onConfigChange`

## 3. Tests

- [x] 3.1 Backend: remove old expression-based filter test; add test for each of the 9 operators
- [x] 3.2 Backend: add tests for AND combinator (all must pass), OR combinator (any must pass)
- [x] 3.3 Backend: add tests for missing field treated as null, empty conditions passes all rows
- [x] 3.4 Frontend: `FilterConfig.test.tsx` — renders combinator toggle and condition rows from props
- [x] 3.5 Frontend: test AND/OR toggle calls onChange with updated combinator
- [x] 3.6 Frontend: test value input hidden for unary operators, visible for binary
- [x] 3.7 Frontend: test type-aware input (number vs text) based on analyzeSchema field type
- [x] 3.8 Frontend: test Add condition and Remove condition update the config
- [x] 3.9 Frontend: test hydration — existing conditions rendered correctly from persisted config
