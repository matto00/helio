## 1. Backend

- [x] 1.1 Add Flyway migration `V27__add_sort_op.sql` extending `pipeline_steps.op` CHECK constraint to include `'sort'`
- [x] 1.2 Add `"sort"` to `allowedOps` in `PipelineStepRoutes.scala`
- [x] 1.3 Implement `applySort` in `InProcessPipelineEngine.scala` — multi-column stable sort, nulls last, empty sortBy is no-op
- [x] 1.4 Wire `"sort"` case in `InProcessPipelineEngine.applyStep` dispatching to `applySort`

## 2. Frontend

- [x] 2.1 Create `SortConfig.tsx` — ordered list of {field, direction} pairs, with add/remove/direction-toggle, field selector from `columns` prop
- [x] 2.2 Add Sort to the `OP_TYPES` array in `PipelineDetailPage.tsx` (id: "sort", label: "Sort rows", icon)
- [x] 2.3 Wire `SortConfig` into the StepCard rendering branch in `PipelineDetailPage.tsx`
- [x] 2.4 Add `sort` case in `handleAddStep` supplying initial config `{"sortBy": []}`
- [x] 2.5 Add `parseSortConfig` helper and `sortConfig` state in `PipelineDetailPage.tsx`

## 3. Tests

- [x] 3.1 Add `applySort` unit tests in `InProcessPipelineEngineSpec.scala` — asc, desc, multi-column, nulls last, empty sortBy
- [x] 3.2 Add `SortConfig.test.tsx` — renders sort keys, add/remove/direction toggle, empty state
