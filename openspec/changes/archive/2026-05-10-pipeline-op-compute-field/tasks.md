## 1. Backend

- [x] 1.1 Update `PipelineAnalyzeService.inferCompute` to read unified config shape `{"column","expression","type"}` instead of `{"outputs":[...]}`
- [x] 1.2 Verify `InProcessPipelineEngine.applyCompute` tolerates the `type` key (no code change expected — confirm and document)

## 2. Frontend

- [x] 2.1 Create `ComputeFieldConfig.tsx` with column-name text input, expression text input, and available-fields hint list
- [x] 2.2 Add `parseComputeConfig` helper in `PipelineDetailPage.tsx` (mirrors `parseFilterConfig` / `parseCasts` pattern)
- [x] 2.3 Add compute config state (`computeConfig`) to `StepCard` with during-render sync
- [x] 2.4 Add `handleComputeChange` handler in `StepCard` that serializes and patches the step
- [x] 2.5 Wire `ComputeFieldConfig` into `StepCard` body for `op === "compute"`
- [x] 2.6 Set initial config for compute op in `handleAddStep`: `{"column":"","expression":"","type":"number"}`

## 3. Tests

- [x] 3.1 Write `ComputeFieldConfig.test.tsx`: render column/expression inputs; available fields hint; config hydration; onChange patch
- [x] 3.2 Write or extend backend Scala test: `inferCompute` with unified shape appends field; `inferCompute` with malformed config returns validationError
- [x] 3.3 Write or extend backend Scala test: `applyCompute` arithmetic; division by zero → null; unknown field → null
