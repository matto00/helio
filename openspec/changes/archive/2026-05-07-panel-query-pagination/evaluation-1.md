# Evaluation Report — Cycle 1

## Phase 1: Spec Review — FAIL

### Issues

1. **CRITICAL: Missing ACL checks on execute endpoint (Task 1.7)**
   - **Spec requirement**: "The endpoint SHALL require authentication and apply panel ACL checks consistent with other panel sub-routes."
   - **Current state**: PanelExecuteRoutes does not check if the authenticated user has access to the panel's dashboard.
   - **Impact**: A malicious authenticated user could execute arbitrary queries on panels in dashboards they don't own, violating data access controls.
   - **Evidence**: PanelExecuteRoutes constructor takes `user: AuthenticatedUser` but never passes it to any authorization check. Compare with PanelRoutes.scala line 309-314 where `aclDirective.authorizeResourceWithSharing("dashboard", panel.dashboardId.value, Some(user), ...)` is called.

2. **Incomplete error handling for non-SQL sources**
   - **Spec requirement**: Implicit in "only SQL data sources are supported."
   - **Current state**: The endpoint returns a 400 error for non-SQL sources, but this behavior is not covered by backend tests.
   - **Impact**: Low severity, but inconsistent with spec documentation that states "Pagination is only supported for SQL data sources."

3. **No UI test coverage for load-more interaction**
   - **Task 4.2 requirement**: Tests should cover pagination interactions.
   - **Current state**: No Playwright or component tests for the "Load more" button rendering when `hasMore: true`, button disabled state, or click handling.
   - **Impact**: Load-more button behavior is untested and could regress silently.

### Passes

- ✓ PaginatedQueryResult schema and model correctly defined with all required fields
- ✓ Frontend Redux state structure matches spec (currentPage, hasMore, isLoadingMore, rows)
- ✓ Table panels correctly dispatch fetchPanelPage on mount (Task 3.6)
- ✓ Metric and chart panels remain unaffected and use preview endpoints
- ✓ All backend parameter validation (page >= 0, 1 <= pageSize <= 500) implemented
- ✓ 404 errors for non-existent and unbound panels implemented
- ✓ JSON schema and OpenAPI spec files created
- ✓ All tasks marked [x] in tasks.md

## Phase 2: Code Review — FAIL

### Issues

1. **Security: Missing ACL directive injection (PanelExecuteRoutes.scala:15-20)**
   - PanelExecuteRoutes constructor is missing `aclDirective: AclDirective` and `permissionRepo: ResourcePermissionRepository` parameters.
   - Every panel operation that modifies or accesses user-scoped data must verify authorization via the dashboard ownership check.
   - **Remediation**: Add these parameters and call `aclDirective.authorizeResourceWithSharing` before executing any query, similar to PanelRoutes duplicate operation.

2. **Logic: Empty result set handling in columns extraction (PanelExecuteRoutes.scala:125-127)**
   - If `pageRows.headOption` is empty, `columns` becomes an empty vector. While unlikely in practice (page 0 almost always returns rows), this edge case is not explicitly tested.
   - **Remediation**: Add a test case for "last page with fewer rows than pageSize" to verify columns extraction works correctly.

3. **Test coverage: Non-SQL source rejection not tested (PanelExecuteRoutesSpec.scala)**
   - The error message "Pagination is only supported for SQL data sources" is constructed but never tested.
   - **Remediation**: Add test case `"return 400 for CSV-backed data source"` or similar.

4. **Frontend: Missing error handling for failed pagination requests**
   - panelsSlice.ts fetchPanelPage.rejected (line 384-393) sets `isLoadingMore: false` but doesn't set an error message.
   - If a pagination request fails, the user sees no error feedback and the button becomes clickable again without any explanation.
   - **Remediation**: Add an error state to PanelPaginationState and display it in the UI.

### Passes

- ✓ No unnecessary duplication; code is DRY
- ✓ Naming is clear (fetchPanelPage, paginationState, hasMore, etc.)
- ✓ Modular: PanelExecuteRoutes is its own routes class, properly separated
- ✓ Type safety: PaginatedQueryResult uses proper case classes, no `any` types
- ✓ Input validation: page and pageSize parameters validated at route entry
- ✓ Error handling at boundaries: 404, 400, 500 responses all handled
- ✓ No dead code or leftover TODO/FIXME comments
- ✓ No over-engineering: offset/page-based pagination is appropriate for v1

## Phase 3: UI Review — N/A (cannot run dev server in evaluation environment)

**Reason**: Phase 3 requires running the frontend dev server with a live backend. The evaluation environment does not have an initialized PostgreSQL database or the ability to start long-running services.

However, code review of the UI logic shows:
- PanelContent.tsx correctly renders paginationRows when available (line 73)
- Load-more button displays only when hasMore: true (line 98)
- Button is disabled during loading (line 103, aria-busy attribute correct)
- PanelGrid.tsx properly passes pagination state to PanelContent
- handleLoadMore correctly dispatches fetchPanelPage with incremented page number
- usePanelData hook correctly branches table panels to fetchPanelPage

**Deferred validation**: E2E behavior of load-more button (click, network request, appended rows, final state) should be tested in Phase 3 before merge.

## Overall: FAIL

The ACL security issue in PanelExecuteRoutes is a blocker that prevents any user from safely using the pagination feature. The missing UI test coverage and error handling are secondary concerns.

## Change Requests

### Critical (must fix before merge)

1. **Add ACL checks to PanelExecuteRoutes**
   - Update PanelExecuteRoutes constructor to accept `aclDirective: AclDirective` parameter
   - Before calling `executePaginated`, wrap the logic in `aclDirective.authorizeResourceWithSharing("dashboard", panel.dashboardId.value, Some(user), "Dashboard not found")` with proper access level checks (Viewer → 403, Editor/Owner → allow)
   - Add test case to PanelExecuteRoutesSpec: `"return 403 for unauthorized user"` (create a panel in a dashboard owned by a different user)
   - **Files to modify**:
     - `backend/src/main/scala/com/helio/api/routes/PanelExecuteRoutes.scala` (constructor, routes logic)
     - `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (pass aclDirective to constructor)
     - `backend/src/test/scala/com/helio/api/routes/PanelExecuteRoutesSpec.scala` (add authorization test)

### High (should fix)

2. **Add UI test for load-more button**
   - Create test in `frontend/src/components/PanelContent.test.tsx` (or PanelGrid.test.tsx) that:
     - Renders a table panel with paginationRows and hasMore=true
     - Verifies button is visible and enabled
     - Clicks the button and verifies onLoadMore callback is invoked
   - Test the disabled + loading state when isLoadingMore=true

3. **Add error state to pagination**
   - Add optional `error: string | null` field to PanelPaginationState interface
   - Update fetchPanelPage.rejected reducer to set this error
   - Display error message in PanelContent below the table when error is present
   - Test error display in PanelContent.test.tsx

### Medium (nice to have)

4. **Test non-SQL source rejection**
   - Add backend test case to PanelExecuteRoutesSpec: `"return 400 for non-SQL data source"`
   - Seed a CSV data source instead of SQL and verify the response is 400 with appropriate message

## Non-blocking Suggestions

- Consider documenting the LIMIT pageSize+1 trick in the code comment (line 115) to explain hasMore detection
- The columns extraction from pageRows (line 125-127) could add `.filter(_.nonEmpty)` to be extra defensive, though the current logic is fine

## Summary

The implementation is largely well-architected and follows project patterns. However, the missing ACL checks in PanelExecuteRoutes create a security vulnerability that must be resolved before this change can be merged. Once the authorization logic is added and tested, the remaining issues (UI test coverage, error handling) are straightforward fixes.
