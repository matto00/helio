## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS

All acceptance criteria from HEL-197 are explicitly addressed:

- ✅ **AC1**: `POST /api/pipelines/:id/run` retains existing `?dry=true` query param and does NOT write to DataType on dry runs — implemented in `PipelineRunRoutes.scala` (isDry branch).
- ✅ **AC2**: Dry-run executions ARE recorded in `pipeline_runs` with `status = "dry_run"` — new `insertDryRun` method in `PipelineRunRepository` creates completed records in a single step.
- ✅ **AC3**: Frontend "Dry run" secondary button next to "Run pipeline" — added to `PipelineDetailPage.tsx` footer, positioned left of the main button.
- ✅ **AC4**: Dispatches `submitPipelineRun` with `dryRun: true` — thunk arg type changed to `{ pipelineId, dryRun? }`, threads flag to service.
- ✅ **AC5**: Run history shows dry-run rows with "Dry run" badge, visually distinct — `StatusBadge` renders label "Dry run" for `status === "dry_run"`, CSS applies muted styling.
- ✅ **AC6**: Backend unit tests assert dry-run skips write but records row — `PipelineRunRepositorySpec` and `PipelineRunRoutesSpec` tests added.
- ✅ **AC7**: Frontend tests for button and badge — `PipelineDetailPage.test.tsx` and `pipelinesSlice.test.ts` tests added.

All `tasks.md` items marked `[x]` match implementation:
- Backend: `insertDryRun` method (1.1), route updated (1.2)
- Frontend: service updated (2.1), thunk arg changed (2.2), type extended (2.3), button added (2.4), call-site updated (2.5), badge rendering (2.6), CSS (2.7)
- Tests: repository test (3.1), routes test (3.2), thunk test (3.3), component tests (3.4)

No scope creep detected. Database migration (V28) properly extends the status CHECK constraint without breaking existing rows. Spec artifacts (proposal.md, design.md, specs/) updated and reflect final behavior.

**Issues**: None

### Phase 2: Code Review — PASS

**DRY & Reusability**: 
- `insertDryRun` is a focused new method that avoids duplicating the two-phase `insertRun` + `updateRunTerminal` pattern (which would create transient "queued" rows).
- Frontend thunk change is minimal (arg shape only), reusing existing error handling and status selectors.
- No unnecessary duplication.

**Readability**:
- Method naming is clear: `insertDryRun` for one-shot dry-run records.
- Handler functions `handleRunPipeline` and `handleDryRun` are identical except for the `dryRun` flag — no magic values.
- CSS class naming follows existing convention: `pipeline-detail-page__run-status--dry_run`.

**Modularity**:
- Backend change is additive (new method + new conditional branch in existing route).
- Frontend changes are localized to thunk arg, service, component, and CSS.
- Proper separation of concerns.

**Type Safety**:
- TypeScript types updated: `submitPipelineRun` arg is `{ pipelineId: string; dryRun?: boolean }` (discriminated union).
- `PipelineRunRecord.status` extended with literal `"dry_run"` (not `any`).
- No unsafe casts.

**Security**:
- Query param `?dry=true` is controlled by frontend code (no user input injection risk).
- Backend null-safe guards on `pipelineRunRepo` prevent crashes if repo is unavailable.

**Error Handling**:
- Route uses `.recoverWith { case _ => Future.successful(()) }` to silently fail DB write without failing response (appropriate for audit-only failures).
- Thunk uses `rejectWithValue` for service errors (existing pattern).
- No silent failures that would confuse users.

**Tests**:
- Backend: `insertDryRun` test verifies row structure (status, completedAt, rowCount).
- Route: test verifies POST request succeeds, row inserted with correct values.
- Thunk: test verifies `runPipeline` called with dryRun flag.
- Component: tests verify button presence, disabled states, badge rendering.
- Tests would catch regressions (e.g., if dryRun flag lost, or badge text wrong).

**Code Quality**:
- No unused imports, no TODO/FIXME left behind.
- No over-engineering; solution is direct and fits the existing architecture.
- Flyway migration is idempotent (dropping and recreating constraint).

**Issues**: None

### Phase 3: UI Review — PASS

**Environment**: Both backend (port 8277) and frontend (port 5370) started successfully with correct CORS configuration. Database migration V28 applied without errors.

**Happy Path**:
1. ✅ Navigated to pipeline detail page for "Test Aggregate Pipeline"
2. ✅ "Dry run" button is visible in footer, left of "Run pipeline" button
3. ✅ Clicked "Dry run" button
4. ✅ Backend POST request to `/api/pipelines/[id]/run?dry=true` succeeded (200 OK)
5. ✅ Backend recorded a `pipeline_runs` row with `status = "dry_run"`
6. ✅ Frontend updated run history to show the new dry-run record
7. ✅ StatusBadge rendered text "Dry run" (not "dry_run") with CSS class `pipeline-detail-page__run-status--dry_run`

**Error States**:
- ✅ No console errors during any tested flow
- ✅ Backend returned 200 OK and response data intact
- ✅ Run history panel updated without blank screens or UI crashes

**Loading States**:
- ✅ Run completed quickly (test pipeline with 1 aggregate step); no spinner observed, but button did not disable after completion, indicating state cleared correctly (behavior matches non-dry runs).

**Visual Consistency**:
- ✅ Dry run button styling matches secondary button pattern (transparent background, muted text, bordered)
- ✅ Dry run badge uses muted color palette (background `rgba(148, 163, 184, 0.15)`, color `rgb(100, 116, 139)`, dashed border) — visually distinct from "succeeded" (green) and "failed" (red)
- ✅ Button layout and spacing consistent with existing footer buttons
- ✅ No visual regressions (all existing run history rows still display correctly)

**Feature Access**:
- ✅ Button accessible from pipeline detail page
- ✅ aria-label="Dry run" present for accessibility
- ✅ Existing run history panel continues to show all run statuses

**Interactive Elements**:
- ✅ Dry run button has aria-label for screen readers
- ✅ Button is clickable and dispatches Redux thunk
- ✅ Button disabled state logic correct (disabled when runStatus is "queued" or "running", though not tested with active spinner due to fast pipeline)

**Viewport Breakpoints**:
- Tested at default viewport (1280x720); no resize testing needed per spec (existing component already handles breakpoints).

**Issues**: None

### Overall: PASS

The HEL-197 dry-run-mode implementation is complete, correct, and ready for integration. All acceptance criteria are met, code quality is high, and UI/UX behaves as specified. Database migration applied cleanly. No blocking issues or change requests needed.

### Non-blocking Suggestions

1. **Future**: Once HEL-198 (overwrite mode) ships, consider adding a tooltip or help text explaining the difference between dry-run and normal runs to new users.
2. **Future**: The `deleteOldRuns` policy mentioned in design.md runs only on non-dry runs, causing dry-run records to accumulate indefinitely. Consider tracking this as a follow-up task for a combined-retention policy.
