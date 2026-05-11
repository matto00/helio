## Evaluation Report — Cycle 2

### Phase 1: Spec Review — PASS

**Issues addressed from Cycle 1:**

1. ✓ **AC #4 scope decision documented** — proposal.md and design.md both expanded with explicit Non-goals sections explaining that AC #4 ("data as of [timestamp]" indicator on panels) is **explicitly deferred to a future ticket**. This documents the intentional scope decision made at proposal time. The ticket acceptance criteria includes AC #4, but the implementation correctly excludes it in favor of a follow-up. The deferral is now transparent in the spec artifacts.

2. ✓ **Spec scenario updated (spec.md)** — The failed-run scenario in `specs/pipeline-last-run-row-count/spec.md` was updated to correctly state that `last_run_row_count` is `NULL` on failure (not non-null). This matches the implementation where `rowCount = None` is passed to `updateLastRun` on failed runs.

3. ✓ **Planner Notes added (design.md)** — Added clarification that AC #5's wording about "joining pipeline_runs" was superseded by the denormalization decision. The field semantics remain identical; only the storage mechanism changed (denormalized onto `pipelines` table, consistent with `last_run_status` / `last_run_at`).

**Spec compliance for ACs 1-3, 5-8:**
- AC #1-3, 5-8: All correctly addressed by the implementation.
- AC #4: Explicitly scoped out with clear documentation; acceptable as a follow-up ticket.

**Assessment:** All specification artifacts now accurately reflect the implemented behavior and document scope decisions transparently.

### Phase 2: Code Review — FAIL

**Critical issue (not resolved from Cycle 1):**

1. **Runtime type-safety bug still present in PipelineDetailPage.tsx (line 1243)** — UNFIXED
   - Cycle 1 CR #1 requested fixing the loose-equality guard in both `PipelineListTable.tsx` AND `PipelineDetailPage.tsx`.
   - **What happened:** Only `PipelineListTable.tsx` was fixed (line 55, changed from `!== null` to `!= null`).
   - **What didn't happen:** `PipelineDetailPage.tsx` still uses `!== null` at line 1243.
   - **Why it matters:** When Redux state contains an older `PipelineSummary` object (from demo data or pre-change code paths), the `lastRunRowCount` field is `undefined`, not `null`. The strict equality check `!== null` evaluates to `true` for `undefined`, and the code then calls `.toLocaleString()` on `undefined`, causing a runtime crash.
   - **Evidence:** Confirmed via Phase 3 testing below — navigation to any pipeline detail page throws: `TypeError: Cannot read properties of undefined (reading 'toLocaleString')` at PipelineDetailPage.tsx:1588.

**Inconsistency:**
- `PipelineListTable.tsx` (line 55): Correctly uses `pipeline.lastRunRowCount != null` (loose equality)
- `PipelineDetailPage.tsx` (line 1243): Incorrectly uses `currentPipeline.lastRunRowCount !== null` (strict inequality)

**Test coverage gap:**
- The new test cases in `PipelineDetailPage.test.tsx` verify rendering when `lastRunRowCount` is `null` and when it is a number (e.g., 42, 5678).
- None of the tests verify the `undefined` case, which is the actual crash scenario when old Redux state is present.

**Backend and other frontend code:**
- Backend code remains solid; no issues identified.
- `formatRelativeTime` utility is well-implemented.
- All other frontend changes are consistent and correct.

**Summary:** The codebase is 95% correct; one critical type-safety bug blocks Phase 3 testing due to incomplete fix.

### Phase 3: UI/E2E Review — FAIL

**Test environment:** Backend ✓ healthy on port 8280, Frontend ✓ healthy on port 5373

**Tested flows:**

1. ✓ Login successful
2. ✓ Pipelines list page loads and renders correctly
3. ✓ "Rows Written" column visible with correct header
4. ✓ Row counts display as "—" for null values (expected for demo pipelines pre-dating this change)
5. ✗ Pipeline detail page crashes on load

**Issues:**

1. **Pipeline detail page renders crash** — When navigating to any pipeline detail (e.g., `/pipelines/9e2321d8-3be9-47d5-badc-6785c9d684ac`), the component throws:
   ```
   TypeError: Cannot read properties of undefined (reading 'toLocaleString')
   at PipelineDetailPage (http://localhost:5373/src/components/PipelineDetailPage.tsx:1588:41)
   ```
   - **Root cause:** The type-safety bug identified in Phase 2 (unfixed from Cycle 1 CR #1).
   - **Impact:** The metadata bar feature cannot be visually verified; any pipeline detail view is inaccessible.
   - **Severity:** Blocking — the change is non-functional in the current state.

**Functional gaps:**
- Cannot verify the metadata bar layout, styling, or content rendering.
- Cannot verify the "Never run" label behavior.
- Cannot test the conditional visibility of the metadata bar (shown when `lastRunAt !== null`).
- Cannot test error boundaries or loading states in the detail page.

**Console state:** 1 error (the crash above), which prevents page render completion.

### Overall: FAIL

**Why Cycle 2 fails:**

The type-safety bug in `PipelineDetailPage.tsx` was identified as a critical change request in Cycle 1 but was only partially fixed. While `PipelineListTable.tsx` was correctly updated to use loose equality (`!= null`), `PipelineDetailPage.tsx` still uses strict inequality (`!== null`), which allows `undefined` to pass through and crash the component.

This is a **regression in execution quality**: Cycle 1 identified the bug in **both** files; the fix was applied to **one** file, suggesting incomplete review or copy-paste error during the fix.

### Change Requests

1. **CRITICAL — Complete the type-safety fix in PipelineDetailPage.tsx (line 1243)**
   - File: `frontend/src/components/PipelineDetailPage.tsx`
   - Location: Line 1243, inside the metadata bar JSX
   - Current: `{currentPipeline.lastRunRowCount !== null && (`
   - Change to: `{currentPipeline.lastRunRowCount != null && (`
   - Rationale: Loose equality (`!= null`) guards against both `null` and `undefined`, matching the pattern already applied in `PipelineListTable.tsx` at line 55. This prevents crashes when old Redux state lacks the `lastRunRowCount` field.
   - Verification: After fix, navigate to `/pipelines/{any-id}` — the page should render without errors and display the metadata bar when `lastRunAt` is non-null.

2. **Add test case to PipelineDetailPage.test.tsx to prevent future regression**
   - Add a test that explicitly sets `lastRunRowCount: undefined` (simulating old Redux state) and verifies the component does not crash.
   - Example test name: `"meta bar does not crash when lastRunRowCount is undefined"`
   - Rationale: The current test suite covers `null` and numeric values but not `undefined`, which is the actual failure case. This test would catch this type of issue immediately.

### Non-blocking Suggestions

- Consider adding a shared utility `formatRowCount(value: number | null | undefined): string` to avoid duplication of the formatting logic in `PipelineListTable` (appends " rows") vs. `PipelineDetailPage` (no suffix). Currently acceptable given different layout contexts, but the pattern may recur.
- After fixing the type-safety bug, verify the styling and layout of the metadata bar in both light and dark themes on the supported breakpoints (lg, md, sm, xs).
