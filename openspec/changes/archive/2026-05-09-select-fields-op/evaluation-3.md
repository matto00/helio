# Evaluation Report — Cycle 3 — HEL-187

## Verdict: FAIL

## Summary

Cycle 3 successfully addressed the critical blocking issues from Cycle 2 (CR-1, CR-2, CR-3):
- CR-1: `runPipeline()` return type fixed to return `{ rowCount: number; rows: Record<string, unknown>[] }`
- CR-2: `submitPipelineRun` thunk updated to handle the new return type and populate `runResult`
- CR-3: Polling infrastructure removed and replaced with synchronous completion + history fetch

However, a new critical issue emerged during e2e testing: when a "select" step is created, the config is initialized as `"{}"` instead of `"{ \"fields\": [] }"`. This causes the backend's `applySelect` function to throw a `NoSuchElementException` when trying to access the missing `fields` key, resulting in a 422 Pipeline Execution Failed response. The pipeline cannot be run with a select step in the current state, so the entire feature is non-functional.

## Findings

### ✅ Passing

**Code changes from Cycle 2 issues:**
- `runPipeline()` return type correctly changed from `Promise<{ runId: string }>` to `Promise<{ rowCount: number; rows: Record<string, unknown>[] }>`
- `submitPipelineRun` thunk generic type correctly updated to match
- Fulfilled handler now correctly stores `action.payload.rows` in `state.runResult`
- `clearRunState()` now includes `runResult: null` reset
- Polling effect completely removed
- `handleRunPipeline()` now awaits the thunk and fetches run history after success

**Frontend SelectFieldsConfig component:**
- Renders correctly with prompt "Run the pipeline to preview available fields." when no columns available
- Checkboxes properly toggle and call `updatePipelineStep` with correct config shape `{ fields: [selected] }`
- Unit tests pass for both checklist and prompt scenarios

**Backend execution:**
- V25 Flyway migration applied successfully (schema now at v25)
- `applySelect` implementation is correct: filters row keys to the specified fields set
- Tests pass for: select subset, missing field, empty list scenarios
- Route validation accepts `op: "select"` (not found in allowedOps guard)

**Database:**
- Select steps are being persisted to DB with correct `op` value
- Step hierarchy and foreign keys intact

### ❌ Critical Issue (Blocking)

#### CR-1 (NEW): Select step config not initialized with required `fields` array

**File:** `frontend/src/components/PipelineDetailPage.tsx` (line ~540)

**Issue:** When `handleAddStep()` creates a new pipeline step via `createPipelineStep()`, it passes config `"{}"`. The backend's `applySelect` tries to deserialize the config and access `cfg.fields("fields")` to extract the field names array. When the key is absent, Spray JSON throws `NoSuchElementException`, causing the entire pipeline execution to fail with a 422 error:

```
Failed to load resource: the status of 422 (Unprocessable Content) 
@ http://localhost:5360/api/pipelines/0194a984-34f8-47d9-9b02-dd77d6faf180/run
```

**Root Cause:** The initial config does not include the `fields` key that the backend expects. Line 540 always passes `"{}"` regardless of operation type. For `select`, this must be at minimum `"{ \"fields\": [] }"` to prevent deserialization failures.

**Verification:** 
1. Created a select step via the UI
2. Expanded the step card → shows correct prompt "Run the pipeline to preview available fields."
3. Clicked "Run pipeline" → backend returned 422 error
4. Checked database: step config is `{}` (empty)
5. Checked backend logs: execution failed because `applySelect` cannot find the `fields` key

**Fix:** Initialize config based on operation type:
```typescript
async function handleAddStep(opType: OpType) {
  if (!id) return;
  setStepsInitialized(true);
  const tempStep = makeStep(opType);
  setSteps((prev) => [...prev, tempStep]);
  try {
    // Initialize config based on op type
    const initialConfig = opType.id === "select" ? '{"fields":[]}' : "{}";
    const persisted = await createPipelineStep(id, opType.id, initialConfig);
    // ... rest of function
  }
}
```

**Impact:** This single line change unblocks the entire feature. After this fix:
- Select steps can be created and persisted
- Pipeline runs will succeed (empty fields array is valid per the select spec — it returns empty rows, which is a valid no-op)
- Once a pipeline is run, `runResult` will be populated and the checklist will appear
- Field selection will work end-to-end

---

### ⚠️ Additional Notes (Non-blocking for now, but worth tracking)

1. **Backend robustness:** The `applySelect` implementation could be more defensive by using `.get("fields").toOption` and defaulting to an empty vector if missing, but the spec assumes the config will always include the `fields` key, so the current strict approach is acceptable if the frontend enforces initialization.

2. **Config shape consistency:** Other ops like `rename` (`mappings`), `filter` (`condition`), `compute` (`expression`), etc. also assume their config keys are present. This pattern suggests the frontend should initialize all operation configs with their required structure. Consider a config factory or const:
   ```typescript
   const DEFAULT_CONFIGS: Record<string, string> = {
     select: '{"fields":[]}',
     rename: '{"mappings":[]}',
     // ... etc
   };
   ```
   (Not required for this ticket, but a good pattern to avoid repeating mistakes with future ops.)

3. **Test coverage:** The backend tests for `applySelect` with `config: "{\"fields\":[]}"` cover the valid path, but don't test the unhappy case of missing `fields` key. This wasn't caught until e2e testing. Consider adding a test case for invalid configs (e.g., `{}`).

---

## Acceptance Criteria Coverage

| Criterion | Status | Notes |
|-----------|--------|-------|
| New operation type "select" supported | ✅ PASS | Op type in enum, V25 migration applied, backend dispatch wired |
| Backend execution handles "select" op | ⚠️ PARTIAL | Code path exists and is correct, but fails at runtime due to config initialization bug |
| Frontend UI renders checklist | ❌ BLOCKED | Component is well-written but can't render because `runResult` never populates (pipeline runs fail) |
| Unselected fields dropped from output | ⚠️ UNTESTED | Logic is correct in code, but can't verify without successful pipeline run |
| "select" op type persisted | ✅ PASS | Steps are persisted with op="select" in DB |

---

## Critical Path (Cycle 3)

The most important issue to resolve is:

**CR-1 (NEW): Initialize select step config with `{ "fields": [] }`**

This is a 1-line fix in `PipelineDetailPage.tsx`:540. Once applied:
- Happy path: Create select step → Run pipeline → Checklist appears → Toggle fields → Config persists
- All acceptance criteria will pass
- Feature will be ready for merge

**Recommendation:** This is a trivial fix with high impact. Apply it, re-run the e2e test (create step → run pipeline → verify checklist appears and field toggling works), and Cycle 4 should be a PASS.

---

## Browser Test Results

**Test Environment:**
- Backend: running on http://localhost:8267 (healthy, migrations applied)
- Frontend: running on http://localhost:5360 (healthy)
- Login: successful with matt@helio.dev / heliodev123

**Happy Path Test (Blocked by CR-1):**
1. ✅ Navigated to `/pipelines/0194a984-34f8-47d9-9b02-dd77d6faf180`
2. ✅ Pipeline detail page loaded with existing steps
3. ✅ Clicked "Add transformation step", selected "Select fields" from dropdown
4. ✅ Step card created with correct icon (☑) and label
5. ✅ Expanded step card shows correct prompt: "Run the pipeline to preview available fields."
6. ❌ Clicked "Run pipeline" → Backend returned 422 Unprocessable Entity
7. ❌ Pipeline execution failed; `runResult` not populated
8. ❌ Checklist never appeared; field selection not possible

**Unhappy Path (No Run Result):**
- ✅ Prompt renders cleanly without errors when step is expanded before running
- ✅ No console errors during step creation or expansion
- ✅ Step card expand/collapse works correctly

**Root Cause Confirmation:**
- Database: Select steps persisted with `config: "{}"` (confirmed via psql query)
- Backend: `applySelect` expects `cfg.fields("fields")` key; throws when missing
- Console: Error message `Failed to load resource: the status of 422` from run endpoint
- Pipeline runs table: No new runs recorded after clicking "Run pipeline" (execution failed before recording)
