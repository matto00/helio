## 1. Backend

- [x] 1.1 Add `applyLimit` private method to `InProcessPipelineEngine` — truncates rows to `config.count`; treats missing/zero/negative count as no-op (return all rows)
- [x] 1.2 Add `"limit"` case in `InProcessPipelineEngine.applyStep` dispatching to `applyLimit`

## 2. Frontend

- [x] 2.1 Create `frontend/src/components/LimitConfig.tsx` — numeric input for row count, min=1, calls `onChange` with `'{"count":<n>}'` on valid change
- [x] 2.2 Add `{ id: "limit", label: "Limit rows", icon: "⬆" }` entry to `OP_TYPES` in `PipelineDetailPage.tsx`
- [x] 2.3 Add `parseLimitConfig` helper in `PipelineDetailPage.tsx` — parses `{"count":<int>}` from config string
- [x] 2.4 Add `limitCount` state with `parseLimitConfig` initializer in `StepCard` (alongside existing `selectedFields`, `renames`, etc.)
- [x] 2.5 Add `"limit"` initial config `'{"count":100}'` in `handleAddStep` switch chain
- [x] 2.6 Add `"limit"` render branch in `StepCard` body to show `LimitConfig`
- [x] 2.7 Add `handleLimitChange` handler in `StepCard` — calls `updatePipelineStep` and `onConfigChange`

## 3. Tests

- [x] 3.1 Add `InProcessPipelineEngineSpec` cases: limit to N rows, count > total rows (returns all), count = 0 (no-op/returns all)
- [x] 3.2 Add `PipelineAnalyzeServiceSpec` case: limit step produces pass-through schema and no validationError (if not already covered)
- [x] 3.3 Add `LimitConfig` Jest test: renders numeric input, calls onChange with correct JSON on valid entry
