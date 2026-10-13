- `frontend/src/features/panels/ui/PanelCard.test.tsx` — DELETED; split into the three files below (36 tests, sorted name diff vs base empty)
- `frontend/src/features/panels/ui/PanelCardHeader.test.tsx` — new: F-128 header actions (6), F-099 drag handle (1), HEL-706 duplicate guard (3) = 10
- `frontend/src/features/panels/ui/PanelCardHeader.refreshFullscreen.test.tsx` — new: HEL-579 refresh placement/activation, HEL-584 fullscreen (+ DIALOG_FOCUSABLE_SELECTOR) = 18
- `frontend/src/features/panels/ui/PanelCardBody.test.tsx` — new: HEL-576 badge (4), HEL-539 retry (2), prop-stability (2, kept last) = 8
- `frontend/src/features/panels/ui/editors/ChartAppearanceEditor.tsx` — DELETED (unrendered dead editor)
- `frontend/src/features/panels/ui/detailModal/panelDetailChartState.ts` — DELETED (buildInitialChart fed only the dead editor)
- `frontend/src/features/panels/ui/editors/AppearanceEditor.tsx` — dropped showChartSection/chartAppearance/setChartAppearance
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` — dropped the dead props at the call site
- `frontend/src/features/panels/ui/detailModal/usePanelDetailEditState.ts` — dropped chartAppearance state, reset line, return fields
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.chartTypeDefault.test.tsx` — deleted HEL-1378 tests 1-2 (subject deleted) and the capture wrapper; test 3 byte-identical; header comment updated
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.appearance.css` — removed rules only the deleted editor used; kept chart-label and color-swatches (added a note)
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.mobile.css` — comment at ~:213 (chart-label) noted as having no renderer (not a stale pointer, appended a note)
- `frontend/src/features/panels/ui/PanelCard.crossFilter.test.tsx` — comment -> OutputPanelContent.tsx's filteredPaginationRows
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts` — comment -> PanelCardBody's useOutputMeta(outputId)
- `frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx` — header + annotationState comment: Output editor (OutputKindFields.tsx), dropped false BindingEditor/Appearance-section claims
- `frontend/src/features/panels/hooks/useCrossFilteredPanelData.ts` — comment: PanelCard -> usePanelCardInspect (same-class sweep hit)

## Task 1.3 per-class repo-wide `git grep` (frontend e2e docs, excl. archive), after deleting the editor
- section-heading, chart-section, chart-subsection, chart-type-label/selector/radio/option(+:hover,--active)/section/icon/name: only their own CSS rules -> REMOVED
- chart-label: CSS rule + checkbox rule, pinned by PanelDetailModal.css.test.ts:179, mobile.css:219 -> KEPT, no remaining renderer
- color-swatches: CSS rules, pinned by PanelDetailModal.css.test.ts:186, mobile.css:228 -> KEPT, no remaining renderer
- mobile.css:213 comment names chart-label rows: recorded; appended a note that the renderer is gone

## Task 2.4 sweep
`rg 'PanelCard(\.tsx)?`?[ ,]'` over non-test comments in frontend/src. Fixed: useCrossFilteredPanelData.ts (x2). Left (still accurate): PanelFullscreenOverlay, useCrossFilterServerOps, PanelCardSkeleton, MobilePanelStack, PanelCardBody, PanelContent, PanelCard.tsx. Reported, not fixed (other class: stale `BindingEditor` mentions): ChartAggregationFields.tsx, MetricValueEditor.tsx, useBoundOrLiteralState.ts.

## Cycle 2 (evaluation-1.md CR1): comments citing the deleted PanelCard.test.tsx
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.errorRetry.test.tsx` — comment :15 -> PanelCardBody.test.tsx
- `frontend/src/features/panels/ui/editors/OutputControlsEditor.test.tsx` — comments :3, :214 -> PanelCardHeader.refreshFullscreen.test.tsx
- `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.kindLock.test.tsx` — comment :90 -> PanelCardHeader.refreshFullscreen.test.tsx
- `frontend/src/features/panels/ui/PanelCard.inspect.test.tsx` — comment :15 reworded to "the then-large PanelCard test file" (optional suggestion taken)

`git grep -n "PanelCard\.test\.tsx" -- frontend e2e docs` after the edits: no hits (exit 1).
