## Context

HEL-228 added `pipeline_steps` (V23 migration) with op CHECK constraint `('rename', 'filter', 'join', 'compute', 'groupby', 'cast')`.
HEL-229 delivered `InProcessPipelineEngine` — a `foldLeft` over steps dispatching on `step.op` string.
The frontend `PipelineDetailPage` maintains a local `OP_TYPES` array and renders a stub step-card body
("Configure this … step") with no per-op config UI.

`"select"` is absent from the DB CHECK constraint, so the API will reject `POST /api/pipelines/:id/steps`
with `op: "select"`. A new Flyway migration is required before anything else ships.

## Goals / Non-Goals

**Goals:**
- Add V25 Flyway migration extending the CHECK constraint to include `'select'`
- Wire `applySelect` into `InProcessPipelineEngine.applyStep`
- Render a field-checklist config UI in the step-card body for `select` ops
- Keep all changes additive; no existing ops are modified

**Non-Goals:**
- Server-side schema inference (field list is derived from prior-step run output in the UI)
- Field reordering guarantees
- Wildcard / regex field patterns

## Decisions

### D1 — ALTER TABLE + DROP + ADD CONSTRAINT for Flyway (not recreate table)

PostgreSQL does not support `ALTER TABLE … ALTER CONSTRAINT` for CHECK constraints. The standard
workaround is `ALTER TABLE pipeline_steps DROP CONSTRAINT <name> ADD CONSTRAINT <name> CHECK (…)`.
The migration must know the constraint name from V23. V23 uses an inline CHECK with no explicit name,
so PostgreSQL auto-names it `pipeline_steps_op_check`. The migration uses that name.

Alternative considered: recreate the table. Rejected — data loss risk; the inline approach is
straightforward and well-tested in the codebase (V9 did a schema fix without recreating tables).

### D2 — applySelect: filter Map keys

`applySelect` receives `fields: Vector[String]` from the step config and calls
`row.view.filterKeys(fields.toSet).toMap` on each row. Missing fields are silently omitted
(same tolerance as `applyRename` which ignores absent columns).

Alternative: throw on missing field. Rejected — field names may differ between pipeline runs if
the source schema changes; silent omission is more robust.

### D3 — Frontend: render checklist inside expanded StepCard body, derive fields from last run output

The `StepCard` body currently shows a placeholder. For `select` ops, replace it with a checklist
of column names derived from the prior step's (or source's) last run result rows, stored in the
Redux `pipelines.runResult` slice field added by HEL-229. If no run result is available,
show a "Run pipeline to preview fields" prompt.

Selected field names are stored in the step's config JSON as `{ "fields": ["col_a", "col_b"] }`.

Alternative: hardcode field names in the op form. Rejected — dynamic inference is the spec requirement.

### D4 — OP_TYPES array in PipelineDetailPage gains a "select" entry

The existing `OP_TYPES` constant in `PipelineDetailPage.tsx` drives both the dropdown and the
step-card icon/label. Add `{ id: "select", label: "Select fields", icon: "☑" }` there.

## Risks / Trade-offs

[Constraint name assumption] → If a future migration renames the constraint before V25 runs on a fresh
DB, V25 fails. Mitigation: use `IF EXISTS` clause and verify name in integration test.

[No run result = empty checklist] → The UI degrades gracefully with a prompt, not a crash.

## Migration Plan

1. V25 migration ships with the code change in the same PR.
2. Flyway auto-runs on backend startup; no manual step needed.
3. Rollback: re-add the constraint without `'select'` (no existing `select` rows in dev).

## Planner Notes

- The frontend step list and config UI are currently fully local state (not persisted); the
  executor reads persisted steps from the DB. The select config UI writes to the step's `config`
  JSON via the existing `PATCH /api/pipeline-steps/:id` endpoint — no new endpoint needed.
- `applyStep` already has a catch-all `Future.failed` branch for unknown ops, so any env with
  the old constraint will fail-fast on a `select` step at runtime, not silently.
