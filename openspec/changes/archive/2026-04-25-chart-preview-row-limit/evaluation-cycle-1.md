# Evaluation Report - Cycle 1

**Ticket**: HEL-71 - Chart panel: increase preview row limit for meaningful visualization  
**Change**: chart-preview-row-limit  
**Date**: 2026-04-24  
**Evaluator**: linear-evaluator agent

## Summary

Implementation is **INCOMPLETE** - one existing test needs updating to account for the new API signature.

## What Was Implemented

### Backend ✅
- Added `?limit=N` query parameter to `GET /api/data-sources/:id/preview` in `DataSourceRoutes.scala`
- Limit is properly clamped to range 1–500 with default of 10
- Correctly passes limit to `SchemaInferenceEngine.parseCsvRows`
- Added comprehensive test coverage in `DataSourceRoutesSpec.scala`
  - Test for `?limit=200` returning 200 rows
  - Test for no limit parameter returning 10 rows (default)
- **All backend tests pass** (270 succeeded, 0 failed)

### Frontend ✅ (mostly)
- Updated `fetchCsvPreview` in `dataSourceService.ts` to accept optional `limit` parameter
- Updated `usePanelData.ts` to pass `limit=200` for chart panels, `undefined` for others
- Added two new test cases:
  - Chart panels call `fetchCsvPreview` with `limit=200` ✅
  - Non-chart panels call `fetchCsvPreview` with `limit=undefined` ✅

## Issues Found

### 🔴 Critical: Test Failure

**File**: `frontend/src/hooks/usePanelData.test.ts:148`

**Test**: "fetches CSV preview and maps fieldMapping for a CSV-bound panel"

**Error**:
```
expect(jest.fn()).toHaveBeenCalledWith(...expected)
Expected: "src-csv"
Received: "src-csv", undefined
```

**Root Cause**: This existing test was not updated to reflect the new `fetchCsvPreview` signature. The function now always receives two parameters `(sourceId, limit)`, but the test only expects one.

**Fix Required**: Update line 148 from:
```typescript
expect(mockFetchCsvPreview).toHaveBeenCalledWith("src-csv");
```
to:
```typescript
expect(mockFetchCsvPreview).toHaveBeenCalledWith("src-csv", undefined);
```

**Impact**: Test suite fails (1 failed, 231 passed). This blocks the pre-commit hook.

## Code Quality Review

### Strengths
- Clean implementation matching the spec exactly
- Proper bounds checking (1–500 clamp)
- Appropriate default behavior (10 rows for non-chart panels)
- Good test coverage for new functionality
- No breaking changes to existing API consumers

### Architecture Alignment
- Follows existing request flow pattern
- Maintains backwards compatibility (default limit)
- Conditional logic in `usePanelData` is minimal and clear
- Query parameter approach is lightweight and RESTful

## Acceptance Criteria

From HEL-71:

- [ ] Chart panels render at least 200 rows of data when available — **Implementation correct, but untested in UI**
- [x] Table and metric panels are unaffected (still receive small preview) — **Verified via code + new test**
- [ ] Large CSV sources don't cause timeout/memory issues — **500-row server cap addresses this, but not load-tested**

## Manual Testing Status

❌ **Not performed** - Dev server not started, UI not tested.

## Recommendations

### Required for Cycle 2
1. **Fix the failing test** in `usePanelData.test.ts:148` (trivial one-line change)
2. **Manual UI verification**:
   - Start dev server + backend
   - Create a chart panel with a CSV source containing 200+ rows
   - Verify chart renders with meaningful data density
   - Verify table/metric panels still show limited preview

### Optional Enhancements (Future)
- Consider adding a test with a CSV source >500 rows to verify server-side clamping
- Add telemetry to track actual limit usage patterns

## Verdict

**Status**: NEEDS REVISION  
**Blocker**: Failing test prevents pre-commit from passing  
**Estimated Fix Time**: < 5 minutes  
**Ready for PR**: No

## Next Steps

1. Update test assertion to expect `(sourceId, undefined)`
2. Re-run frontend test suite to verify all tests pass
3. Start dev environment and perform manual UI testing
4. If manual testing passes, ready for cycle 2 evaluation or PR
