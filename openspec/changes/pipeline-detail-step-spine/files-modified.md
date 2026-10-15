# Files modified (HEL-1579)

Enumerated from `git diff --name-only $(scripts/concertino/resolve-review-base.sh ...)...HEAD` (base `cd64409ad`).

## Backend
- `backend/src/main/resources/db/migration/V135__pipeline_run_step_row_counts.sql` — `pipeline_runs.step_row_counts` and `pipelines.last_run_step_row_counts` (JSONB, NULL = not recorded, no backfill; V104 precedent). V135 re-checked free on origin/main and in every local branch before commit.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepRowCounts.scala` — the engine's `stepCounts` <-> the stored JSON text.
- `PipelineRunExecutor.scala`, `PipelineRunSucceededWrites.scala`, `PipelineRunTerminalWrites.scala` — `stepCounts` threaded through `onRunSuccess` -> `unblockedChain` -> `onUnblockedRunSuccess` -> `writeTerminal` / `writeLastRun`; the succeeded path is the only one that passes counts.
- `PipelineRunRepository.scala`, `PipelineRepository.scala` — new column on the run row / the pipeline table, written in the same statement as `row_count` / `last_run_row_count`; the reaper SQL writes NULL on both; `PipelineSummary.lastRunStepRowCounts`.
- `PipelineProtocol.scala`, `PipelineServiceSupport.scala` — `PipelineSummaryResponse.lastRunStepRowCounts` (an object on the wire, omitted when not recorded). The field notes moved above the case class because `scripts/check-schema-drift.mjs` extracts case-class fields with a regex that stops at the first `)` and splits on commas, so any comment inside the parameter list hides later fields.
- `OutputRoutes.scala`, `OutputProtocol.scala` — `GET /api/pipelines/:id/outputs` carries `panelCount` per item (one batched `panelCountsFor`, same visibility as `listPanels`).
- Tests: `PipelineRunStepRowCountsRlsSpec` (non-BYPASSRLS `helio_app_test`: owner run path, editor-grantee `*Internal` path, stranger reads nothing, failed write clears, reaper clears), `PipelineRunRoutesSpec` (+2: succeeded run writes both columns; failure and dry run leave NULL), `PipelineAclSpec` (+2: field omitted when never run, present as an object in the single and list responses), `OutputRoutesSpec` (+1: owner and grantee `panelCount`), `FireTimeRunConfigGateSpec` / `LateFinisherSpecBase` (their `updateRunTerminal` overrides take the new parameter).
- `schemas/pipelines/pipeline-summary.schema.json` (new), `schemas/outputs/output.schema.json` (panelCount description).

## Frontend: desktop layout (new)
- `ui/spine/PipelineSpineLayout.tsx` (+ `.css`, `PipelineSpineAccent.css`) — the grid (header, strip, spine | main | reserved live-output track), selection, save seam, preview dedupe.
- `ui/spine/PipelineSpineHeader.tsx` (+ `.css`), `SpineRunStatus.tsx`, `SpineScheduleChip.tsx`, `SpineStatusStrip.tsx` — header row, status chip, schedule chip, denial strip.
- `ui/spine/PipelineSpine.tsx` (+ `.css`), `SpineLane.tsx`, `SpineStepRow.tsx`, `SpineSourceCard.tsx`, `SpineOutputs.tsx` — the spine.
- `ui/spine/StepPreviewTable.tsx` (+ `.css`) — rows after the selected step.
- `ui/StepCardFocused.tsx` (+ `.css`) and `ui/stepCardTypes.ts` — the focused editor.
- `ui/PipelineDetailDialogs.tsx` — the five dialogs as a sibling of the layout (so crossing 768px does not unmount an open dialog).
- `hooks/useStepSelection.ts` (`?step=`), `hooks/useStepPreviewFetch.ts` (shared fetch/debounce), `hooks/useStepSaveSeam.ts`, `state/stepSaveContext.tsx`, `state/inFlightDedupe.ts`, `state/stepRowCount.ts`, `state/summarizeStepConfig.ts`.
- `app/hidesBreadcrumbItemName.ts` + a 7-line change in `app/CommandBar.tsx` (the only shell edit, C6).

## Frontend: edited
- `ui/PipelineDetailPage.tsx` — branches on `useIsPhoneShell()`; the phone JSX is unchanged except that its dialogs moved to the shared sibling component.
- `hooks/useStepCardPersist.ts`, `hooks/useStepCardState.ts` — opt-in `flushOnUnmount` / `cancelPendingRef` (the phone passes neither and keeps clear-on-unmount); registers each step PATCH with the page's pending-saves tracker when a provider exists.
- `hooks/useStepCardPreview.ts` — now a thin wrapper over the shared `useStepPreviewFetch` (same rules, plus a stale-response guard).
- `shared/chrome/ActionsMenu.tsx` (+ `ariaLabel` on an item), `shared/ui/DataGrid.tsx` / `.css` (`ColumnDef.headerType`).
- `types/pipelineStep.ts` (`lastRunStepRowCounts`).

## Tests and ledger
See `test-migration.md` (per-file counts, replacements, e2e triage, recorded runs).

## UI decisions taken (for the PR body)
1. `StepCardFocused` is a sibling of `StepCard`, not a `variant` prop on it (design D7 said variant): a discriminated prop union broke the type of every existing `StepCard` test spread; behaviour and DOM are as designed.
2. Accent: native checkbox/radio `accent-color` is neutral (`--app-text`) on the desktop page, scoped to `.pipeline-detail-page--spine` (D12; the AC's "only Run, the selected step and focus" outranks DESIGN §0's allowance for selection controls). The shared diff-chip / add-button recolouring is likewise scoped, so the phone keeps its accent.
3. The selected row's controls deepen to `--app-accent-mid` on hover (the state-surface guard needs a measurable rung on an accent-wash backdrop); the accent audit allows everything inside the selected row.
4. Row menu items read "Move up"/"Move down" with the accessible names "Move step up/down in <source>"; `ActionsMenuItem` gained an optional `ariaLabel` for that.
5. Below 1100px the header drops the "Pipelines /" crumb (the command bar already names the section) and narrows the schedule chip so the name, status and controls stay on one row at 820px.
6. The spine column is `clamp(270px, 22vw, 340px)`; at 820px the centre column is tight (about 246px) because the context list keeps its 248px; the editor wraps its action row and the table scrolls inside itself.
7. Selection of a created step follows it through the temp-id -> server-id swap in the same render (state-adjusted, no flash to the first step).
8. Shared deliberate consequence of D7: leaving the page (or switching pipelines) with a pending debounced edit now SENDS it (the phone card still drops it); the PATCH goes to that step's own id.
9. The empty-pipeline centre column says "Nothing to edit yet" (design left the copy open).
10. The preview table's hover rows and the header controls use the HEL-866 rungs for their real backdrops (canvas vs card surface), per the state-surface guard.
11. Local development used a dedicated database `helio_hel1579` (the worktree's gitignored `backend/.env`) so V135 was not applied to the shared dev DB the other lanes run against (the shared-DB Flyway hazard).

## Findings worth a spinoff
- A missing wire field reads `undefined`, not `null` (spray-json drops `None`): the new header crashed on `lastRunRowCount.toLocaleString()` until guarded with `!= null`; types still say `null` in several places (`PipelineSummary.lastRunRowCount`, `lastRunStatus`).
- `PipelineSpine.tsx` (346 lines) and `PipelineSpineLayout.tsx` (about 310) are over the ~250 soft budget; the row-menu builder is the obvious extraction.
- The non-AI create path swaps the temp id for the server id without a `renderKey`, so the selected editor remounts once when its create resolves (it is disabled during the create, so nothing is lost).
- `scripts/check-schema-drift.mjs` field extraction is not paren/comma aware inside comments (documented in its own header; worked around, not fixed).

## Cycle 2 (evaluation-1.md)
1. `useStepCardPersist.ts`: the unmount flush now calls the page's `onConfigChange` after its PATCH succeeds, so a re-selected editor, the spine summary and the analyze fingerprint show the saved value (test `spineEditing.test.tsx:508`, shown red first: "Unable to find an element with the display value: 240").
2. New last-trunk-row "Insert step after" test (`spineEditing.test.tsx:252`); ledger rows now cite file:line.
3. Narrow desktop: `.spine-body__main` is a size container; below 480px the filter rows put the field on its own line, below 340px every control is full width with remove beside the field (`PipelineSpineLayout.css`). (Superseded in cycle 3: the schedule chip stays visible at every width, compact then icon.) At or below 1100px the pipeline name keeps its room via `min-width: 14ch` on the crumbs container. UI decision for the PR: this replaces "the column is tight" (decision 6). The 820/900/1100 e2e now asserts the field and value controls are at least 120px wide and the name stays readable, in both themes.
4. `SpineStepRow.tsx`: the row button's accessible name now ends with the marker states (", draft, not yet saved", ", has a validation error", ", N schema warnings", ", couldn't save the last change to this step"); tests in `spine.test.tsx` and `spineEditing.test.tsx`.

## Cycle 3 (evaluation-2.md)
- The schedule chip is no longer hidden at <=1100px: compact there (expression ellipsized, "next run" text only in its title, "Paused" kept), a calendar icon plus the "Paused" marker at <=900px; "Add schedule" keeps its accessible name. The name keeps `min-width: 14ch`. UI decision for the PR.
- e2e "820/900/1100/1280" seeds a PAUSED schedule and asserts the chip, its "Paused" text, its title and that it sits inside the viewport, in both themes (8/8 spine tests pass, 1280x800 and 1440x900 no-scroll included).
- Spec/design: header narrow-width rules recorded in `specs/pipeline-detail-spine-layout`, `specs/pipeline-schedule-config-ui` and design D3.

## Cycle 4 (evaluation-3.md)
- The 14ch floor moved from `.spine-header__name` to `.spine-header__crumbs` (name `min-width: 0`, ellipsis inside), so the name can no longer run under the status chip. The e2e (820/900/1100/1280, both themes, after `document.fonts.ready`) now asserts no header item overlaps the next; shown red first: `820px dark: "spine-header__name" (right 428) overlaps "ui-status-chip" (left 414)`.
- At <=900px the "rows written" meta group is hidden cleanly instead of truncating to nothing (figures stay in Run history). UI decision for the PR.
- The paused chip's accessible name is "Edit schedule, paused"; icons use `ICON_SIZE.sm`; the misplaced narrow-width comment moved above its media block.

## Cycle 5 (evaluation-4.md) UI decisions
- Narrow-width header rules now key off the PAGE width (a container query on `.pipeline-detail-page--spine`: viewport minus rail and context list, 200-400px), not the viewport: <=800px container = "Pipelines /" crumb hidden, compact schedule chip; <=600px = last-run chip shows only its dot (label visually hidden, still its accessible name), Dry run is icon-only (name and title "Dry run" kept), Run shows "Run" (accessible name "Run pipeline" kept), a paused chip drops its icon (the "Paused" word stays), the crumbs floor is 8ch, the "rows written" meta is hidden, gaps and padding tighten.
- The spine track is `clamp(180px, 22vw, 340px)` (was 270 min) so the centre column survives a 400px context list at 769px; the editor's action row wraps (`flex-wrap`).
- New RED-FIRST e2e "sweep 769-1100px": 42 widths in 8px steps plus 1100, both themes, context list at default (248) and max (400) via the splitter's End key, one page load per theme x list width, after `document.fonts.ready`. Asserts header scrollWidth <= clientWidth, every header item inside the viewport and non-overlapping, editor actions inside the centre column, no document scroll, and the actions menu opens inside the viewport at 769/825/897/1100. Runs in about 14s. RED against the old CSS: `769px dark list=default: header scrollWidth must not exceed clientWidth`.

## Declared paths (full, from `git diff --name-only cd64409ad..HEAD`, this branch's own commits)

- `backend/src/main/resources/db/migration/V135__pipeline_run_step_row_counts.sql`
- `backend/src/main/scala/com/helio/api/protocols/pipelines/OutputProtocol.scala`
- `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineProtocol.scala`
- `backend/src/main/scala/com/helio/api/routes/pipelines/OutputRoutes.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunRepository.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunExecutor.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunSucceededWrites.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunTerminalWrites.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineServiceSupport.scala`
- `backend/src/main/scala/com/helio/services/pipelines/PipelineStepRowCounts.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/OutputRoutesSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineRunStepRowCountsRlsSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/FireTimeRunConfigGateSpec.scala`
- `backend/src/test/scala/com/helio/services/pipelines/LateFinisherSpecBase.scala`
- `e2e/hel1007-multi-root-reorder.spec.ts`
- `e2e/hel1275-metric-delta-sparkline.spec.ts`
- `e2e/hel1277-output-history-scrubber.spec.ts`
- `e2e/hel1306-chart-reference-lines.spec.ts`
- `e2e/hel1311-heatmap-histogram-charts.spec.ts`
- `e2e/hel1331-history-payloads-toggle.spec.ts`
- `e2e/hel1345-rootid-step-placement.spec.ts`
- `e2e/hel1350-chart-compare-picker.spec.ts`
- `e2e/hel1390-chart-tail-aggregate-live.spec.ts`
- `e2e/hel1392-remount-staleness.spec.ts`
- `e2e/hel1510-output-editor-table-overflow.spec.ts`
- `e2e/hel1521-lane-picker-dependents.spec.ts`
- `e2e/hel1579-pipeline-spine-layout.spec.ts`
- `e2e/hel908-step-card-split.spec.ts`
- `e2e/hel908-trunk-reorder-drag.spec.ts`
- `e2e/hel908-trunk-reorder-order.spec.ts`
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts`
- `e2e/hel958-join-step-editor.spec.ts`
- `e2e/state-surface-contrast-guard.spec.ts`
- `e2e/support/accentAudit.ts`
- `e2e/support/pipelineSpine.ts`
- `frontend/src/app/App.test.tsx`
- `frontend/src/app/CommandBar.test.tsx`
- `frontend/src/app/CommandBar.tsx`
- `frontend/src/app/hidesBreadcrumbItemName.test.ts`
- `frontend/src/app/hidesBreadcrumbItemName.ts`
- `frontend/src/features/pipelines/hooks/useStepCardPersist.ts`
- `frontend/src/features/pipelines/hooks/useStepCardPreview.ts`
- `frontend/src/features/pipelines/hooks/useStepCardState.ts`
- `frontend/src/features/pipelines/hooks/useStepPreviewFetch.ts`
- `frontend/src/features/pipelines/hooks/useStepSaveSeam.ts`
- `frontend/src/features/pipelines/hooks/useStepSelection.test.tsx`
- `frontend/src/features/pipelines/hooks/useStepSelection.ts`
- `frontend/src/features/pipelines/state/inFlightDedupe.test.ts`
- `frontend/src/features/pipelines/state/inFlightDedupe.ts`
- `frontend/src/features/pipelines/state/stepRowCount.ts`
- `frontend/src/features/pipelines/state/stepSaveContext.tsx`
- `frontend/src/features/pipelines/state/summarizeStepConfig.test.ts`
- `frontend/src/features/pipelines/state/summarizeStepConfig.ts`
- `frontend/src/features/pipelines/types/pipelineStep.ts`
- `frontend/src/features/pipelines/ui/PipelineDetailDialogs.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.creatingStep.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.draftCreate.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.reorderGuard.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.shapeReparent.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.spine.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.spineEditing.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.stepsError.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.switch.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`
- `frontend/src/features/pipelines/ui/StepCardFocused.css`
- `frontend/src/features/pipelines/ui/StepCardFocused.tsx`
- `frontend/src/features/pipelines/ui/pipelineDetailPageTestUtils.ts`
- `frontend/src/features/pipelines/ui/pipelineSpineTestKit.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpine.css`
- `frontend/src/features/pipelines/ui/spine/PipelineSpine.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineAccent.css`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.css`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.tsx`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineLayout.css`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineLayout.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineLane.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineOutputs.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineRunStatus.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineScheduleChip.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineSourceCard.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineStatusStrip.test.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineStatusStrip.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineStepRow.tsx`
- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.css`
- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.tsx`
- `frontend/src/features/pipelines/ui/stepCardTypes.ts`
- `frontend/src/shared/chrome/ActionsMenu.test.tsx`
- `frontend/src/shared/chrome/ActionsMenu.tsx`
- `frontend/src/shared/ui/DataGrid.css`
- `frontend/src/shared/ui/DataGrid.test.tsx`
- `frontend/src/shared/ui/DataGrid.tsx`
- `frontend/src/theme/elevationTokenGuard.css.test.ts`
- `frontend/src/theme/motionTokenGuard.css.test.ts`
- `schemas/outputs/output.schema.json`
- `schemas/pipelines/pipeline-summary.schema.json`
