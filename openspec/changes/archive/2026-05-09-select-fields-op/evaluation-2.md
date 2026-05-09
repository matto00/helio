# Eval Report — Cycle 2 — HEL-187

## Verdict: CHANGES_REQUESTED

## Summary

Cycle 2 made significant progress on step persistence and config hydration, but the critical blocker from Cycle 1 remains unfixed: `runPipeline()` in `pipelineService.ts` still has the wrong return type (`Promise<{ runId: string }>` instead of the actual response shape `Promise<{ rowCount: number; rows: Record<string, unknown>[] }>`). Without this fix, the `runResult` field is never populated, so the SelectFieldsConfig checklist never appears. The feature cannot work end-to-end until this is resolved. Backend execution works correctly; frontend async flow is broken.

## Findings

### ✅ Passing

**Backend & Database:**
- V25 Flyway migration correctly drops and re-adds `pipeline_steps_op_check` constraint with `'select'`
- `applySelect` implementation is idiomatic Scala with proper filtering
- `InProcessPipelineEngine` dispatch wiring correct
- Backend engine tests cover all three scenarios (subset, missing field, empty list)
- Route test for `POST /api/pipelines/:id/steps` with `op: "select"` passes and returns 201

**Frontend Structure:**
- `SelectFieldsConfig` component is well-designed and renders correctly in both states (checklist and prompt)
- New `OP_TYPES` entry `{ id: "select", label: "Select fields", icon: "☑" }` is present and correct
- Step lifecycle improvements: `createPipelineStep()` now persists new steps to backend, obtaining real IDs
- Redux state: `runResult: Record<string, unknown>[] | null` added correctly to `PipelinesState`
- Config hydration: `parseSelectedFields()` properly deserializes step config and initializes `selectedFields`
- `handleFieldToggle()` correctly calls `updatePipelineStep()` to PATCH config changes
- `pipelineStepToStep()` mapper converts persisted backend steps to local Step type, including config

**Tests:**
- `SelectFieldsConfig.test.tsx` covers checklist render, prompt render, and both toggle directions
- Mock setup for `updatePipelineStep` prevents real API calls in unit tests
- Redux state fixtures updated to include `runResult: null`

**UI/UX:**
- Step card expand/collapse works; `aria-expanded` toggled correctly
- Placeholder card shows with correct icon and label on first render
- Prompt "Run the pipeline to preview available fields." displays when no run result is present
- No console errors during navigation, step creation, or initial state

---

### ❌ Change Requests (Blocking)

#### CR-1: Fix `runPipeline()` return type in `pipelineService.ts`

**File:** `frontend/src/services/pipelineService.ts` (line ~64–67)

**Issue:** The function signature is:
```ts
export async function runPipeline(pipelineId: string): Promise<{ runId: string }> {
  const response = await httpClient.post<{ runId: string }>(`/api/pipelines/${pipelineId}/run`);
  return response.data;
}
```

But the backend's `POST /api/pipelines/:id/run` endpoint returns:
```json
{ "rowCount": 5, "rows": [{ "col_a": 1, "col_b": "x" }, ...] }
```

**Root Cause:** This mismatch causes `action.payload.runId` to be `undefined` in the `submitPipelineRun.fulfilled` handler (line 254 of `pipelinesSlice.ts`), so `state.runResult` is never set. The SelectFieldsConfig checklist never appears because `runColumns` derived from `runResult` is always empty.

**Fix:** Update the return type and HTTP client generic to match the actual response:
```ts
export async function runPipeline(pipelineId: string): Promise<{ rowCount: number; rows: Record<string, unknown>[] }> {
  const response = await httpClient.post<{ rowCount: number; rows: Record<string, unknown>[] }>(
    `/api/pipelines/${pipelineId}/run`,
  );
  return response.data;
}
```

**Impact:** This single change unblocks the entire select op feature flow.

---

#### CR-2: Update `submitPipelineRun` thunk to handle synchronous result

**File:** `frontend/src/features/pipelines/pipelinesSlice.ts` (lines 112–122, 253–256)

**Current code:**
```ts
export const submitPipelineRun = createAsyncThunk<
  { runId: string },
  string,
  { rejectValue: string }
>("pipelines/submitPipelineRun", async (pipelineId, { rejectWithValue }) => {
  try {
    return await runPipeline(pipelineId);  // Now returns { rowCount, rows } after CR-1
  } catch {
    return rejectWithValue("Failed to start pipeline run.");
  }
});

// ... in extraReducers:
.addCase(submitPipelineRun.fulfilled, (state, action) => {
  state.runId = action.payload.runId;  // Still trying to access runId
  state.runStatus = "queued";
})
```

**Fix:** Update the thunk generic to match the new return type and populate `runResult`:
```ts
export const submitPipelineRun = createAsyncThunk<
  { rowCount: number; rows: Record<string, unknown>[] },
  string,
  { rejectValue: string }
>("pipelines/submitPipelineRun", async (pipelineId, { rejectWithValue }) => {
  try {
    return await runPipeline(pipelineId);
  } catch {
    return rejectWithValue("Failed to start pipeline run.");
  }
});

// ... in extraReducers:
.addCase(submitPipelineRun.fulfilled, (state, action) => {
  state.runId = null;  // No runId in the synchronous response
  state.runStatus = "succeeded";
  state.runResult = action.payload.rows;  // Now set from the response
})
```

**Impact:** Unblocks the checklist from rendering; populates Redux state correctly.

---

#### CR-3: Remove unnecessary polling infrastructure (optional, but recommended for code cleanliness)

**File:** `frontend/src/components/PipelineDetailPage.tsx` (lines 524–545)

**Context:** Cycle 1's design included polling via `fetchRunStatus()` to handle asynchronous run completion. Since `POST /api/pipelines/:id/run` now returns rows synchronously (after CR-1 and CR-2 are applied), the polling interval is no longer necessary.

**Current code (around line 530):**
```ts
const intervalId = setInterval(() => {
  fetchRunStatus(id, runId)
    .then((res) => {
      dispatch(setRunStatus({ status: res.status, error: res.error, rows: res.rows }));
      // Re-fetch history when we observe a terminal status
      if (TERMINAL_STATUSES.has(res.status)) {
        void dispatch(fetchPipelineRunHistory(id));
      }
    })
    // ...
}, 1000);
```

**Fix:** Remove the polling interval. The run status is now set synchronously in the thunk's fulfilled handler, and history can be fetched on demand or via a separate effect. (Alternatively, if you want to keep polling for future long-running operations, add a guard so the interval only starts when `runId` is set and not `null`, but the current structure doesn't support that cleanly.)

For now, the safest fix is:
1. Remove the polling `useEffect` block entirely
2. Replace it with a simple dispatch of `fetchPipelineRunHistory(id)` in `handleRunPipeline()` after the run completes:
```ts
async function handleRunPipeline() {
  if (!id) return;
  try {
    await dispatch(submitPipelineRun(id)).unwrap();
    void dispatch(fetchPipelineRunHistory(id));  // Fetch history after run completes
  } catch {
    // runError is displayed via Redux state
  }
}
```

**Why recommended:** Without this cleanup, the polling interval will continuously call `fetchRunStatus()` even though the data is already available synchronously, wasting network resources.

---

### ⚠️ Notes (Non-blocking)

- **Config persistence guard**: The code now guards against local IDs (`step-N`) when calling `updatePipelineStep()`, which is correct. However, the longer-term fix (POST on step creation to get a real ID, then use that for PATCH) is being addressed with `createPipelineStep()`. Good progress.

- **clearRunState still missing runResult**: The `clearRunState()` reducer (line 153–157) does not reset `runResult`. This was a Cycle 1 issue and should be fixed to prevent cross-pipeline pollution:
```ts
clearRunState(state) {
  state.runId = null;
  state.runStatus = null;
  state.runError = null;
  state.runResult = null;  // Add this line
}
```
(Not critical for Cycle 2, but a known regression vector.)

- **OP_TYPES mismatch**: The frontend lists `{ id: "aggregate" }` in OP_TYPES, but the backend's `allowedOps` uses `"groupby"`. This is a pre-existing mismatch (not introduced here) worth tracking for a follow-up fix.

---

## Browser Test Results

**Test Environment:**
- Backend: running on http://localhost:8267 (healthy)
- Frontend: running on http://localhost:5360 (healthy)
- Login: successful with matt@helio.dev / heliodev123

**Happy Path Test:**
1. ✅ Navigated to `/pipelines`, opened "Updated Pipeline Name"
2. ✅ Clicked "Add step", selected "Select fields" from dropdown
3. ✅ Step card created with correct icon (☑) and label
4. ✅ Expanded step card shows prompt: "Run the pipeline to preview available fields."
5. ❌ **Clicked "Run pipeline ▶"** — Backend returned 200 with rows, but frontend still shows the prompt
6. ❌ No checklist appeared; `runResult` not populated in Redux
7. ❌ Field selection not possible

**Root Cause Confirmed:** Run status changed from "queued" to "succeeded", but `runResult` remained `null` because `runPipeline()` never passed rows to the thunk.

**Unhappy Path (No Run Result):**
- ✅ Prompt renders cleanly without blank screen or errors
- ✅ No console errors when expanding step card initially

---

## Acceptance Criteria Coverage

| Criterion | Status | Notes |
|-----------|--------|-------|
| New operation type "select" supported | ✅ PASS | Backend enum updated, V25 migration in place |
| Backend execution handles "select" op | ✅ PASS | `applySelect` wired into `applyStep`, tests pass |
| **Frontend UI renders checklist** | ❌ **BLOCKED** | Component written but never receives data (runResult is null) |
| Unselected fields dropped from output | ✅ PASS | Backend correctly filters columns |
| "select" op type persisted | ✅ PASS | Flyway migration handles persistence |

---

## Critical Path (Cycle 2)

The most important issues to resolve are:

1. **CR-1 & CR-2 (blocking all UI tests)**: Fix `runPipeline()` return type and update `submitPipelineRun` thunk. These are tightly coupled and must be fixed together. Once fixed, the happy path (checklist appears after pipeline run) will work.

2. **Minor cleanups** (for code health): Remove polling infrastructure (CR-3) and add `runResult = null` to `clearRunState` (prevents cross-pipeline bugs).

**Recommendation for human:**

If you can fix CR-1 and CR-2 now, Cycle 3 should see:
- Happy path working: run pipeline → checklist appears
- Field toggling working: select/deselect fields → PATCH config persists
- End-to-end feature complete and testable

If time is limited, prioritize CR-1 & CR-2 (they are 10 lines total). CR-3 is nice-to-have but not critical for functionality.

