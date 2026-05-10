## Context

Helio pipelines execute in-process (Scala, `InProcessPipelineEngine`). The `sort` op is already
recognized by `PipelineAnalyzeService` (line 64, pass-through identity — output schema = input schema).
However, `InProcessPipelineEngine.applyStep` has no `sort` case, `PipelineStepRoutes.allowedOps` does
not include `"sort"`, and the `pipeline_steps.op` CHECK constraint (last extended by V26 for `limit`)
does not include `sort`. The frontend has no `SortConfig` component.

## Goals / Non-Goals

**Goals:**
- Multi-column stable sort with per-column direction (`asc`/`desc`), nulls last
- `sort` accepted by routes, persisted in DB, executed in engine
- `SortConfig` UI using `analyzeColumns` for field discovery (no "run first" requirement)

**Non-Goals:**
- Spark/distributed sort
- Locale-aware collation
- Custom null placement (always last)
- Sorting by computed/derived expressions

## Decisions

### Config shape: `{"sortBy": [{"field": "...", "direction": "asc"|"desc"}]}`
`PipelineAnalyzeService` does not parse sort config (pass-through), so we are free to define the shape.
This mirrors the pattern from `applyFilter` (array of condition objects) and is self-documenting.
Empty `sortBy` → no-op (return rows unchanged), matching `applyFilter`'s empty-conditions behavior.

### Null handling: nulls last for both asc and desc
Scala's default `Ordering` places `null` before non-null values (NPE risk). We convert `null` to a
sentinel `(1, "")` / `(0, value)` pair so nulls always sort after real values, consistent with SQL
`NULLS LAST`. This avoids a NullPointerException in the comparator.

### Use `analyzeColumns` in `SortConfig` (same as `CastFieldsConfig`/`FilterConfig`)
The analyze endpoint runs on save and returns per-step `inputSchema`. `analyzeColumns` is already
threaded into each `StepCard` via `PipelineDetailPage`. `SortConfig` receives `columns: string[]` and
renders a `<select>` per sort key, matching the established pattern.

### Initial config on `handleAddStep`
`handleAddStep` in `PipelineDetailPage` already special-cases `cast`, `limit`, and `filter-rows`.
Add a `sort` branch that supplies `{"sortBy": []}` as the initial config (empty list → no-op).

### Flyway migration: drop and re-add CHECK constraint (V27)
PostgreSQL does not support in-place extension of CHECK constraints.
Pattern established by V26 (`limit`): `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` with full list.
New constraint: `('rename','filter','join','compute','groupby','cast','select','limit','sort')`.

## Risks / Trade-offs

- [Risk] Large row sets sorted in-process → memory pressure. Mitigation: out of scope for this ticket;
  Spark integration (HEL-202) will handle large-scale sorting.
- [Risk] `sortBy` array order matters (primary → secondary key). Mitigation: `foldRight` over the
  sort keys in reverse order, applying a stable sort per key, so the first key in the array is the
  primary sort key in the final output.

## Planner Notes

- `PipelineAnalyzeService` already handles `"sort"` correctly (pass-through). Zero changes needed there.
- `filter-rows` op from HEL-190 was named `"filter-rows"` in the engine but the test file for the
  engine `InProcessPipelineEngineSpec` should be checked for the existing sort test if any.
- `applySort` implementation: use `Ordering[Option[String]]` with null → None mapping for safe comparison.
- Frontend: `SortConfig.tsx` follows the same component shape as `LimitConfig.tsx` (self-contained,
  receives value + onChange, no internal API calls).
