## Evaluation Report — Cycle 1

### Phase 1: Spec Review — FAIL

**Issues:**

1. **AC #4 "Data as of [timestamp]" indicator on panels** — This acceptance criterion explicitly calls for a "data as of [timestamp]" indicator on panels sourced from a DataType. The design document states this was "explicitly deferred to a future ticket," and the proposal confirms the scope decision was to exclude it. However, AC #4 from the ticket description is not addressed at all, making the implementation incomplete against the ticket's stated requirements.

2. **All other ACs (1-3, 5-8) addressed** — The implementation correctly covers:
   - Pipeline list view displays last-run timestamp (relative), row count, status badge
   - Pipeline detail view metadata section shows the same three fields
   - Dry runs are not counted (only committed runs)
   - Backend: `PipelineSummary` extended with `lastRunRowCount`, `lastRunStatus`, `lastRunAt`
   - JSON schema updated (no breaking changes)
   - Backend repository tests cover JOIN logic and NULL cases
   - Frontend tests cover rendering with/without data

**Specification Compliance:** AC #4 is missing. AC #1-3, 5-8 are met. The ticket description includes the "data as of" indicator as an explicit requirement, not a "nice to have." This is a scope creep decision that was documented in the design but should have been reflected in the ticket acceptance criteria or explicitly negotiated as a follow-up ticket before implementation.

### Phase 2: Code Review — FAIL

**Issues:**

1. **Runtime type-safety bug in PipelineDetailPage.tsx (lines 1243-1248)** — Critical
   - The condition `currentPipeline.lastRunRowCount !== null` does not guard against `undefined`. In JavaScript/TypeScript, `undefined !== null` is `true`.
   - When Redux state contains a `PipelineSummary` object created by older code paths (before this change) or from demo data, the `lastRunRowCount` field may be `undefined`.
   - The code then calls `.toLocaleString()` on `undefined`, causing a runtime error: "Cannot read properties of undefined (reading 'toLocaleString')".
   - **Fix:** Change to `currentPipeline.lastRunRowCount != null` (loose equality) or explicitly check both: `currentPipeline.lastRunRowCount !== null && currentPipeline.lastRunRowCount !== undefined`.
   - **Evidence:** Console error on navigation to pipeline detail page: `TypeError: Cannot read properties of undefined (reading 'toLocaleString')` at line 1588 of PipelineDetailPage.tsx.

2. **PipelineListTable.tsx correctly uses `!= null`** — This file correctly guards against both `null` and `undefined` at line 55. The inconsistency between the two components is a maintainability issue.

3. **DRY / Consistency** — Both `PipelineListTable.tsx` (line 56) and `PipelineDetailPage.tsx` (line 1246) call `toLocaleString()` on row counts, and `PipelineListTable.tsx` appends `" rows"` while the detail page doesn't. This is acceptable (different layout contexts) but could benefit from a shared formatter if the pattern reoccurs.

4. **Backend code is solid** — The Scala changes are clean:
   - Flyway migration correctly adds `BIGINT` column
   - `PipelineRepository.updateLastRun` properly accepts optional `rowCount`
   - `jsonFormat7` → `jsonFormat8` is correct
   - Test cases cover the three scenarios (with row count, without, never run)
   - No scope creep or over-engineering

5. **Frontend type definitions are correct** — `PipelineSummary` interface is updated consistently.

6. **formatRelativeTime utility is well-implemented** — No third-party dependencies, handles edge cases (past vs. future, singular forms), and works correctly in PipelineListTable. No issues found.

7. **Test coverage is comprehensive** — All new test cases pass and cover the main scenarios. The use of `lastRunRowCount` in all relevant fixture files (pipelinesSlice.test, CreatePipelineModal.test, etc.) is thorough.

**Summary:** The backend implementation is solid and follows patterns. The frontend has one critical type-safety bug that breaks the detail page UI when old Redux state is present.

### Phase 3: UI/E2E Review — FAIL

**Tested Flows:**

1. ✓ Pipelines list page loads successfully
2. ✓ "Rows Written" column is visible with correct header
3. ✓ Relative time formatting works in list ("3 hours ago", "2 hours ago", etc.)
4. ✓ Row counts display correctly as "—" when NULL (expected for demo data before this change shipped)
5. ✗ Navigation to pipeline detail page crashes with runtime error

**Issues:**

1. **Pipeline detail page crashes on render** — When navigating to any pipeline detail page (e.g., `/pipelines/9e2321d8-3be9-47d5-badc-6785c9d684ac`), the component throws an error: "Cannot read properties of undefined (reading 'toLocaleString')" at PipelineDetailPage.tsx:1588. This prevents testing of the metadata bar on the detail page.
   - Root cause: The type-safety bug in Phase 2 above.
   - Impact: The detail page UI cannot be verified, and the metadata bar feature is untestable in the current state.

2. **Demo data compatibility** — The existing demo pipelines in the database were created before the `last_run_row_count` column existed, so all have `NULL` values. This is expected and correctly handled in the table (shows "—" for NULL). Once the backend re-runs a pipeline, the row count will be persisted and displayed.

**Functional gaps:**

- The metadata bar in PipelineDetailPage.tsx cannot be visually verified due to the crash.
- The conditional rendering logic (meta bar visible only when `lastRunAt !== null`) cannot be tested.

**Console errors:** 1 error (the toLocaleString crash), 1 warning (unrelated to this change).

### Overall: FAIL

The implementation is blocked by a critical runtime error in PipelineDetailPage.tsx that prevents the detail page from rendering. Additionally, AC #4 from the ticket (data freshness indicator on panels) is missing, though it was intentionally scoped out—this should have been explicitly documented as a follow-up ticket or negotiated before implementation.

### Change Requests

1. **CRITICAL — Fix type-safety bug in PipelineDetailPage.tsx (lines 1243-1248)**
   - Change: `currentPipeline.lastRunRowCount !== null && (`
   - To: `currentPipeline.lastRunRowCount != null && (`
   - Rationale: Loose equality guards against both `null` and `undefined`, matching the pattern already used in PipelineListTable.tsx at line 55.
   - Verification: Navigation to `/pipelines/{id}` should render the metadata bar without errors and conditionally show the row count.

2. **Document AC #4 scope decision**
   - Create a follow-up Linear ticket for "Panel data freshness indicator: 'data as of [timestamp]'" explicitly referencing HEL-200.
   - Update the HEL-200 ticket description or add a comment documenting that AC #4 was intentionally deferred.
   - Rationale: The ticket acceptance criteria includes AC #4, but the implementation excludes it. This gap should be transparent to stakeholders.

### Non-blocking Suggestions

- Consider extracting the row count formatting (`toLocaleString() + " rows"` vs. just `toLocaleString()`) into a shared utility to avoid duplication across `PipelineListTable` and `PipelineDetailPage`.
- Add a test case to PipelineDetailPage.test.tsx that verifies the meta bar does NOT crash when `lastRunRowCount` is `undefined` (to catch this type of issue in the future when Redux state is stale).

