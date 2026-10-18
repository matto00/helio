# HEL-1582 test mapping (C6)

Every jest test that drove the retired phone river view is accounted for: **(a)** retargeted with the same assertion to
the spine or the phone DOM, **(b)** ported to the new phone layout, or **(c)** deleted with its replacement named.
Counts are tests as declared (`it` / `it.each` entries). When the phone layout replaced the river, the nine
`installPhoneShell` page files failed 121 of their 231 tests; the other 110 passed unchanged against the new DOM
(layout-independent queries).

## A. The nine `installPhoneShell` page files (231 tests)

All 121 failures were retargeted (a/b); none was deleted. Shared vocabulary: `pipelineMobileTestKit.tsx`
(`stepRow`, `openStepSheet`, `stepSheet`, `chooseStepAction`, `chooseHeaderAction`, `laneParentLabel`,
`stubDialogMethods`). A river card "open the toggle, edit, read the editor" became "tap the row, edit in the sheet";
`screen` queries for editor controls work unchanged because only one editor exists at a time.

| File (tests / retargeted) | What changed | Assertion kept |
|---|---|---|
| `PipelineDetailPage.test.tsx` (132 / 75) | River card toggles -> step rows + sheet; "Insert step here" gaps -> the sheet's Insert step before/after; "Branch this step" -> Branch from here; header Edit name -> Rename; Run history menu item -> Runs tab; footer -> header status line; remove source chip -> source card menu | all, with the exceptions in section C |
| `PipelineDetailPage.createPlacement.test.tsx` (12 / 12) | gaps/cards -> row sheet actions + `labelsInOrder` over `.spine-row__title`; `laneParentLabel` over the labelled sub-list | all (b: created step's sheet stays open through the create) |
| `PipelineDetailPage.switch.test.tsx` (17 / 14) | `stepButtons` -> `stepRows`; header-prop capture -> `useSpineStepActions`/`PipelineSpine` capture | all, one changed (section C) |
| `PipelineDetailPage.draftCreate.test.tsx` (12 / 9) | card toggle `aria-expanded` -> the same sheet and editor node stay open | all, one changed (section C) |
| `PipelineDetailPage.creatingStep.test.tsx` (4 / 4) | "not expandable while the create is in flight" -> the sheet's editor is disabled ("Saving step...") and the same sheet stays open when the create lands | intent kept (no edit on a temp id) |
| `PipelineDetailPage.stepsError.test.tsx` (7 / 2) | river frame/footer stats -> `.mobile-body` / the "N steps" count line | all |
| `PipelineDetailPage.shapeReparent.test.tsx` (3 / 3) | shape picker via the header's Add Outputs from a shape; lane parent via the sub-list label | all |
| `PipelineDetailPage.reorderGuard.test.tsx` (1 / 1) | seam moved from the river's `onReorderSteps` prop to the `useSpineStepActions` argument | all |
| `PipelineDetailPage.spine.test.tsx` (43 / 1) | `:709` "still renders the river" **inverted**: asserts the phone layout (header, three tabs, list, pills) and that no river/footer/Outputs tab exists | inverted by design |

## B. River-only test files deleted (replacement named)

| Deleted (tests) | Replacement |
|---|---|
| `StepCard.test.tsx` (62): preview tray, persistence preference, header toggle, Move/drag buttons, tail, errored card, warnings, disable/duplicate, unsupported, upsertsource | `StepCardFocused.test.tsx` (20: dispatch, unsupported, upsertsource, validationError once, marker clears, disable/enable/duplicate/remove, disabled editor editable, warnings region + indicators, creating + draft errors); preview tray -> `StepPreviewTable` (spineEditing D8 tests, page `step preview` tests); Move/drag -> `PipelineSpine.test.tsx` + page reorder tests. The toggle, drag handle, `isTail`, and `helio-step-preview-open` preference have no equivalent: the controls no longer exist |
| `StepCard.blurNoRepatch` / `castSaveError` / `enumSaveError` (11 declared, 23 expanded cases) | `git mv` to `StepCardFocused.*.test.tsx`, same assertions (the expand click removed) |
| `PipelineRiverView.test.tsx` (41): drag-drop, Move, gaps, disable/duplicate delegation, shape picker, one-step lane, "+ lane", multi-root, nodePath, warnings | `PipelineSpine.test.tsx` (nodePath wiring x7, warnings in lanes/roots x4); page tests for gaps (HEL-410), Move, disable/duplicate, shape, branch, root removal; spine tests for lanes/sources. The D4a/D4b cases tested the river test's own title helper |
| `PipelineRiverView.multiRootReorder.test.tsx` (11) | `PipelineSpine.test.tsx` reorder block (11): Move up/down per root, head-slot `rootId`, lane names, drag in root 2, cross-root drop ignored, branch lanes no controls, focus follows (**found a real regression: a refused reorder left a stale pending focus; fixed in `useSpineStepActions`**) |
| `PipelineRiverView.emptyOutputs.test.tsx` (1) | none: guarded the river's memoised `StepCard` against a fresh `[]` Outputs prop; the code is deleted |
| `RibbonSegment.test.tsx` (2) | none: the ribbon is deleted |
| `OutputsGalleryTab.test.tsx` (7), `OutputsRail.test.tsx` (3) | `PipelineDetailPage.spine.test.tsx` outputs section (kind/panel count/off-step, no per-Output GET, editor sheet + History menu, "used in 0 panels"); `PipelineMobileLayout.test.tsx` (Output card, New output) |
| `PipelineDetailHeader.test.tsx` (36) | spine header/schedule/menu tests (spine.test), `PipelineMobileLayout.test.tsx` header block, page tests (Edit source, Share, schedule, Rename); sample label under the source -> `PipelineMobileLayout.test.tsx`; chip overflow popover tests: chips no longer exist (source cards) |
| `PipelineDetailFooter.denial` / `stepConfigInvalid` (7) | `spine/SpineStatusStrip.test.tsx` (the same denial, Run-to-update, misconfigured wording, once-for-two assertions) |
| `PipelineDetailPage.css.test.ts` (6) | rewritten: the AI step's move buttons keep their 44px expander; no river rules remain; skeleton rules exist. Footer/step-card assertions go with those controls |
| `OutputHistoryModal.css.test.ts` (2 of 4, the gallery card History button) | the History action is an `ActionsMenu` item on the spine card (spine.test.tsx outputs section) |

## C. Intent that changed (reviewer: these are the judgement calls)

1. **Pending edit on a pipeline switch** (`switch.test` "drops a pending debounced step save"): the sheet's editor, like the
   desktop's, **flushes** on unmount (design D5, spec "Edit then swipe away"). Now asserts the edit is sent once, to
   A's own step id, and never against B.
2. **Open preview refreshes when an insert shifts its index** (`HEL-410`): a modal sheet cannot be open on a step
   while another step's insert happens. The same fingerprint machinery is asserted on the open step's own Move (index
   1 -> 0).
3. **"A later full resync keeps the created draft's card open"** (`draftCreate`): with one sheet, the duplicate that
   caused the resync opens in it (design D5: any added step opens). Asserts the draft keeps its row and, reopened, its
   editor value.
4. **"Hide preview" toggle** (`step preview`): there is no toggle; the preview lives with the open sheet. Asserts it is
   gone once the sheet closes.
5. **Run history modal** tests: the Runs tab shows the same rows inline; assertions on rows, badges and the log toggle
   are unchanged; "Run history is not an always-visible button" now says it is reachable only through the Runs tab.
6. **Schedule "toggle from the bar"**: enable/disable moved into the actions menu on both layouts in HEL-1579; the PUT
   payload assertion is unchanged.
7. **Edit pipeline name** (6 tests): Rename in the actions menu; the field closes on blur and Save/Cancel show only
   while dirty, as on the desktop header.

## D. New tests

`shared/motion/BottomSheet.test.tsx` (15), `mobile/PipelineMobileLayout.test.tsx` (22), `mobile/PipelineMobile.css.test.ts`
(10), `StepCardFocused.test.tsx` (20), `spine/PipelineSpine.test.tsx` (23), `e2e/hel1582-mobile-pipeline.spec.ts` (11 live).
