## 1. Backend

- [x] 1.1 Write V25 Flyway migration to drop and re-add the `pipeline_steps_op_check` constraint including `'select'`
- [x] 1.2 Add `applySelect` method to `InProcessPipelineEngine` (filter row keys to `fields` set)
- [x] 1.3 Wire `"select"` case into `applyStep` dispatching `applySelect`

## 2. Frontend

- [x] 2.1 Add `{ id: "select", label: "Select fields", icon: "☑" }` to `OP_TYPES` in `PipelineDetailPage.tsx`
- [x] 2.2 Implement `SelectFieldsConfig` component: checklist of column names from last run result, with "run pipeline first" fallback prompt
- [x] 2.3 Render `SelectFieldsConfig` in the `StepCard` expanded body when `step.opType.id === "select"`
- [x] 2.4 Wire checkbox toggle to update the step's config `fields` array (via `PATCH /api/pipeline-steps/:id`)

## 3. Tests

- [x] 3.1 Add `InProcessPipelineEngineSpec` test cases: select subset, select missing field, select empty fields list
- [x] 3.2 Add `PipelineStepRoutesSpec` test: `POST` with `op: "select"` returns `201`
- [x] 3.3 Add frontend unit test for `SelectFieldsConfig`: renders checklist from run result, renders prompt when no result
