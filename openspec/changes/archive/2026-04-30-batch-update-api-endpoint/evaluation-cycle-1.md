# Evaluation Report — HEL-155 Cycle 1

**Ticket:** HEL-155 — Design and implement batch update API endpoint
**Branch:** feature/batch-update-api-endpoint/HEL-155
**Verdict:** ❌ FAIL — Backend tests claimed complete but not implemented

---

## Summary

The implementation is structurally sound. The backend route, repository method, JSON protocol, frontend service, thunk, Redux reducer, TypeScript types, JSON Schema files, and OpenAPI spec are all correctly implemented and follow existing project patterns. Frontend tests (270/270 pass), ESLint is clean, and Prettier formatting is correct.

**However, backend tasks 5.1–5.4 are marked `[x]` in `tasks.md` but no corresponding test code exists.** This is a blocking failure.

---

## Passing Criteria

### Backend Route (Tasks 1.1–1.5) ✅
- `POST /api/dashboards/:id/batch` added at `DashboardRoutes.scala:111` — correctly ordered before `path(Segment)` to avoid routing conflicts
- Authentication and ownership checks match the pattern of all other dashboard routes
- Empty ops array returns 400 at route level (`DashboardRoutes.scala:114-115`)
- Unknown `op` values throw `deserializationError` during JSON deserialization → Pekko HTTP returns 400
- `batchUpdate` in `DashboardRepository.scala:187-258` wraps all ops in a single `DBIO.seq(...).transactionally` block — correct all-or-nothing semantics
- `PanelAppearanceOp` verifies the panel belongs to the target dashboard before updating (`DashboardRepository.scala:216-220`)
- `UserPreferenceOp` acknowledged with `DBIO.successful(())` without persisting (by design)
- Response reuses `{ dashboard, panels }` shape (consistent with `DuplicateDashboardResponse`)

### Schemas (Tasks 2.1–2.2) ✅
- `schemas/batch-request.schema.json` and `schemas/batch-response.schema.json` follow the project JSON Schema 2020-12 convention
- `panelLayout`, `panelAppearance`, `dashboardAppearance`, and `userPreference` operations correctly modelled with `additionalProperties: false` and versioning fields

### OpenAPI (Task 3.1) ✅
- `POST /api/dashboards/{id}/batch` added with request/response schema refs and correct auth annotations

### Frontend (Tasks 4.1–4.3) ✅
- `batchUpdate` function added to `dashboardService.ts:97-105`
- `saveDashboardBatch` thunk added to `dashboardsSlice.ts:128-138`
- `saveDashboardBatch.fulfilled` handler correctly updates the dashboard in Redux state (`dashboardsSlice.ts:239-243`)
- `PanelGrid.tsx:241-258` now dispatches `saveDashboardBatch` with a `panelLayout` op instead of the old PATCH thunk
- In-flight guard and debounce preserved unchanged

### Frontend Tests (Task 5.5) ✅
- `dashboardsSlice.test.ts:393-451` verifies `saveDashboardBatch.fulfilled` updates the dashboard layout in Redux state
- All 270 tests pass; ESLint clean; Prettier clean

---

## Failing Criteria

### Backend Tests 5.1–5.4 ❌ — **BLOCKER**

Tasks.md marks all four backend ScalaTest tasks as `[x]` complete:
- 5.1 Happy path — batch with `panelLayout` + `dashboardAppearance` applies both
- 5.2 Rollback — batch with a valid op + a bad panel ref rolls back all
- 5.3 Unknown op → 400
- 5.4 Empty ops → 400

**No test file exists.** `find backend/src/test -name "*.scala" | xargs grep -l "batch"` returns empty. Neither `ApiRoutesSpec.scala` nor any other test file contains the word "batch".

The transactional rollback (5.2) is the highest-risk path in this feature and is completely untested. The happy-path database behavior (5.1) is also untested.

---

## Minor Issues (Non-blocking)

### Unknown op error response format
When an unrecognized `"op"` value is sent, `deserializationError` fires inside `entity(as[BatchRequest])`, and Pekko HTTP's default rejection handler returns 400. The spec requires "400 Bad Request describing the unknown operation type." The status code is correct, but the response body may not be in `ErrorResponse` JSON format — it falls through to Pekko HTTP's default text/plain rejection body rather than a structured `{"message": "..."}`. This is consistent with how all other endpoints handle malformed JSON in this codebase, so it's a minor discrepancy from the design doc's stated intent, not a new regression.

### Undo/redo layout persistence (pre-existing behavior to verify)
`frontend-layout-persistence/spec.md` requires undo and redo to persist via the batch endpoint. The undo/redo path dispatches `setDashboardLayoutLocally`, which updates Redux state. Whether this triggers `persistLayout` in `PanelGrid` depends on the ordering of React effects vs React Grid Layout's `onLayoutChange` callback — this was pre-existing behavior before the batch migration. Not introduced by this ticket, but the spec says it must work. Browser verification was not possible (dev server not running).

---

## Required Fixes

1. **Implement the four missing backend test cases** (tasks 5.1–5.4). A `DashboardBatchSpec.scala` or extension of an existing spec is needed covering:
   - Happy path: `panelLayout` + `dashboardAppearance` ops both committed, response reflects changes
   - Rollback: a `panelAppearance` op referencing a non-existent panel causes full rollback
   - Unknown op: 400 returned (exercising the deserialization path)
   - Empty ops: 400 returned (exercising the route-level guard)
