## Files modified

- `e2e/hel1582-mobile-pipeline.spec.ts`
- `e2e/hel1668-editor-phone-refresh.spec.ts`
- `e2e/hel1668-header-meta.spec.ts`
- `e2e/hel1668-phone-sheet.spec.ts`
- `e2e/hel1668-schema-panel-copy.spec.ts`
- `e2e/support/hel1668.ts`
- `frontend/src/features/pipelines/hooks/useStepDeepLink.ts`
- `frontend/src/features/pipelines/hooks/useStepSelection.ts`
- `frontend/src/features/pipelines/state/resolveStepParam.test.ts`
- `frontend/src/features/pipelines/state/resolveStepParam.ts`
- `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.css`
- `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.test.tsx`
- `frontend/src/features/pipelines/ui/OutputSchemaDisclosure.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.css`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.spine.test.tsx`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`
- `frontend/src/features/pipelines/ui/StepCardFocused.css`
- `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css`
- `frontend/src/features/pipelines/ui/mobile/PipelineMobileLayout.deepLink.test.tsx`
- `frontend/src/features/pipelines/ui/mobile/PipelineMobileLayout.tsx`
- `frontend/src/features/pipelines/ui/outputSchemaPanelPlacement.ts`
- `frontend/src/features/pipelines/ui/pipelineHoverGating.css.test.ts`
- `frontend/src/features/pipelines/ui/spine/PipelineSpine.css`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineAccent.css`
- `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.css`
- `frontend/src/features/pipelines/ui/spine/SpineOutputs.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineRunStatus.tsx`
- `frontend/src/features/pipelines/ui/spine/SpineSourceCard.tsx`
- `frontend/src/features/pipelines/ui/spine/StepPreviewTable.css`
- `frontend/src/features/pipelines/ui/spine/spineCopy.test.tsx`
- `frontend/src/features/sources/hooks/useSourceSampleLabel.ts`
- `frontend/src/features/sources/ui/SourceSampleLabel.tsx`
- `frontend/src/hooks/usePortalPopover.ts`
- `frontend/src/shared/ui/Modal.tsx`
- `frontend/src/shared/ui/Toast.modal.test.tsx`
- `frontend/src/shared/ui/Toast.tsx`
- `frontend/src/shared/ui/toast.css`
- `frontend/src/shared/ui/useTopModalDialog.ts`
- `frontend/src/theme/tokenAuditSweep.css.test.ts`

Note: `e2e/hel1582-mobile-pipeline.spec.ts` -- the hover-contrast test and HEL-1669's Dry run hover test run in a non-touch, hover-capable 375x812 context (HEL-1668 D5); assertions unchanged.

## UI decisions taken overnight (for the PR body)
- Output card reads "from <step>" / "from the pipeline's source".
- The source card omits its kind meta only when the sample label already starts with the kind.
- Toast keeps its phone bottom offset inside the sheet and moves with the sheet during its transforms.
- Desktop header last-run meta: `min-width: 15ch`, hidden at a page container <= 685px (was 600px); at 601-685px it is hidden rather than clipped.
- Phone source-card label gets `margin-top: calc(var(--space-4) + var(--space-1))` when the kind meta is omitted (expander tiling).
- hel1582 hover-contrast test and HEL-1669's Dry run hover test run in a non-touch, hover-capable 375x812 context; HEL-1669 merged first and its light `.mobile-pill` hover rule is gated here (values unchanged).
- Header last-run meta (final-gate CR1): the figure is never cut. The time is always fully visible and the whole "N rows written ·" is either complete or absent (wrap-clip CSS, no JS); `e2e/hel1668-header-meta.spec.ts` (1000, 1024, 375; 14 and 12,345,678 rows; both themes) was red on 90d13bc9a (ellipsized count) and is green.
- Header last-run meta (final-gate round 2): the meta box is sized from the time alone (`contain: inline-size`) and grows into free space, so a hidden count reserves no width (phone: `flex: 1 1 auto` in the run line); `e2e/hel1668-header-meta.spec.ts` gap cases at 1280/1440 were red on 83e44e515 (name truncated) and are green. Stale "ellipsizes" comments fixed.
