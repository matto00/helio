# Evaluation Report — Cycle 1

## Phase 1: Spec Review — FAIL

Issues:

1. **AC #4 (Panels indicator) not implemented** — The acceptance criteria #4 requires "Panels sourced from a DataType show a 'data as of [timestamp]' indicator using the same last-run timestamp from the DataType's associated pipeline." This is completely absent from the implementation. The proposal intentionally defers this as a non-goal, but it remains listed in the ticket's acceptance criteria. This is a scope/spec mismatch that should have been addressed in ticket planning, not left for execution.

2. **Spec vs implementation mismatch on failed non-dry run behavior** — The spec `specs/pipeline-last-run-row-count/spec.md` states: "Scenario: last_run_row_count is set on failed non-dry run → `pipelines.last_run_row_count` is set to 0 or the count at failure point (non-null)". However, the implementation in `PipelineRunRoutes.scala:117` passes `rowCount = None` on failed runs:
   ```scala
   _ <- pipelineRepo.updateLastRun(pipelineId, "failed", Instant.now(), rowCount = None)
   ```
   The spec says "(non-null)" but the implementation allows null. While `Option[Long]` technically permits `None`, the spec should be updated to reflect the actual implementation behavior or vice versa.

3. **AC #5 denormalization note** — The ticket says "These are populated by joining `pipeline_runs`" but the design and implementation denormalize the field onto the `pipelines` table. This is approved in the design but isn't what the AC text says. This is a minor clarification issue — the denormalization approach is sound and documented, but the acceptance criteria wording is misleading.

Other AC items (1, 2, 3, 5, 6, 7, 8): ✓ Verified correct

## Phase 2: Code Review — FAIL

Issues:

1. **CRITICAL BUG in PipelineListTable.tsx:55** — The code uses strict equality `!== null` to check for undefined:
   ```typescript
   {pipeline.lastRunRowCount !== null ? (
     pipeline.lastRunRowCount.toLocaleString() + " rows"
   ```
   If `lastRunRowCount` is missing from the API response (undefined in JavaScript), then `undefined !== null` evaluates to `true`, and the code attempts to call `toLocaleString()` on undefined, causing a runtime error. The TypeScript interface declares `lastRunRowCount: number | null`, but doesn't protect against undefined values from incomplete API responses.

   **Fix:** Use loose equality `!= null` which treats both `null` and `undefined` the same:
   ```typescript
   {pipeline.lastRunRowCount != null ? (
     pipeline.lastRunRowCount.toLocaleString() + " rows"
   ```

2. **formatRelativeTime utility** — ✓ No issues. Well-implemented with no external dependencies, handles edge cases (negative diffs, singular/plural forms).

3. **PipelineRepository changes** — ✓ Column mapping correct, `Option[Long]` matches BIGINT in Flyway migration, dry run logic properly separates non-dry vs dry runs.

4. **JsonProtocols and PipelineRoutes** — ✓ All four response construction sites updated to include `lastRunRowCount`, jsonFormat updated from jsonFormat7 to jsonFormat8.

5. **PipelineDetailPage** — ✓ Correctly uses conditional rendering to guard against null before accessing toLocaleString().

6. **Test coverage** — ✓ Comprehensive: backend tests for row count persistence, failed/never-run cases; frontend tests for meta bar visibility and row count display.

## Phase 3: UI Review — FAIL

**Cannot complete due to Phase 2 blocker**

The PipelineListTable component crashes during render due to the undefined handling bug in Phase 2. The error boundary catches the exception, resulting in a blank screen:

```
TypeError: Cannot read properties of undefined (reading 'toLocaleString')
    at http://localhost:5373/src/components/PipelineListTable.tsx:104:149
```

Without the Phase 2 bug fixed, the UI is not testable. Once the bug is fixed, the following items would need verification:
- Happy path: Login, navigate to pipelines list, verify new "Rows Written" column and relative timestamp display
- Metadata bar visibility in pipeline detail view
- Fallback states ("Never run", dashes for null values)
- Locale-formatted numbers (e.g., "1,234 rows")
- Error states and edge cases
- Visual consistency with existing design patterns
- Keyboard accessibility and ARIA labels

## Overall: FAIL

### Change Requests

1. **Fix undefined check in PipelineListTable.tsx:55** — Change `pipeline.lastRunRowCount !== null` to `pipeline.lastRunRowCount != null` to handle both null and undefined values from the API response.

2. **Resolve AC #4 scope mismatch** — Either:
   - Implement the "data as of [timestamp]" indicator for panels (as per AC #4), OR
   - Remove AC #4 from the ticket and document explicitly that it was deferred to a future cycle
   
   Clarify in the proposal/design whether this is truly out of scope or pending implementation.

3. **Update spec or implementation for failed run row count** — Either:
   - Change `specs/pipeline-last-run-row-count/spec.md` scenario to allow `null` on failed runs, OR
   - Change `PipelineRunRoutes.scala:117` to set `rowCount = Some(0L)` on failed runs to match the spec's "(non-null)" requirement
   
   Recommend updating the spec to match the implementation (None on failure makes semantic sense — no rows were written).

4. **Clarify AC #5 wording** — Update the ticket acceptance criteria #5 to reflect that the field is denormalized onto the pipelines table, not joined from pipeline_runs (the pattern is consistent with existing `last_run_status` / `last_run_at` fields).

### Non-blocking Suggestions

- Consider updating the TypeScript interface or adding a runtime assertion to ensure the API always returns all fields, or explicitly handle missing fields in the response mapping layer.
- The formatRelativeTime utility could benefit from a unit test to verify edge cases (very old dates, future dates, etc.), though the existing implementation looks solid.

## Critical Path (Cycle 1)

The most important issue to resolve for a pass is the **undefined handling bug in PipelineListTable.tsx**, which completely blocks the UI from rendering. This is a 1-line fix (change `!==` to `!=`). Once fixed, Phase 3 can be completed.

Secondary issues (spec/AC clarifications) should be resolved in parallel but don't block functionality.
