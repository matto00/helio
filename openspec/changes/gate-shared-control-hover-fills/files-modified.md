- `e2e/hel1675-shared-hover.spec.ts` — new touch e2e (realTap, computed styles) plus desktop hover fixture, both themes
- `e2e/hel1668-header-meta.spec.ts` — assert the 1280 meta-box-to-trailing gap (<= header gap + 1)
- `frontend/src/shared/chrome/AccentPicker.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/chrome/ActionsMenu.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/chrome/ErrorBoundary.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/chrome/InlineError.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/chrome/MobileNavSheet.css` — `:hover` rules gated in place in `@media (hover: hover)`, mixed list split
- `frontend/src/shared/chrome/Popover.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/chrome/StatusMessage.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/ConfirmInline.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/DataGrid.css` — `:hover` rules gated in place in `@media (hover: hover)`, mixed list split
- `frontend/src/shared/ui/EmptyState.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/FileField.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/IconButton.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/Modal.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/PageHeader.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/SchemaFieldViewer.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/SegmentedRadioGroup.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/SortableTh.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/disclosureSummary.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/shared/ui/inputs.css` — `:hover` rules gated in place in `@media (hover: hover)`, mixed list split
- `frontend/src/shared/ui/toast.css` — `:hover` rules gated in place in `@media (hover: hover)`
- `frontend/src/test/cssHoverGating.ts` — shared CSS rule parser and offender/mixed-list helpers
- `frontend/src/shared/sharedHoverGating.css.test.ts` — new guard walking `shared/**/*.css`, empty allowlist, floor 36
- `frontend/src/features/pipelines/ui/pipelineHoverGating.css.test.ts` — imports the shared parser; assertions and allowlist untouched
- `DESIGN.md` — section 5 `@media (hover: hover)` rule naming both guards
- `frontend/src/features/pipelines/ui/spine/PipelineSpineHeader.css` — merged paired primary hover blocks; rewrote stale ~1100px comment
- `frontend/src/features/pipelines/ui/mobile/PipelineMobile.css` — merged paired `.mobile-pill--primary` hover blocks
- `frontend/src/features/sources/ui/SourceSampleLabel.tsx` — split out presentational `SourceSampleLabelView`
- `frontend/src/features/pipelines/ui/spine/SpineSourceCard.tsx` — calls `useSourceSampleLabel` once, renders the view
- `frontend/src/features/pipelines/ui/spine/SpineSourceCard.useNow.test.tsx` — one `useNow` call per render (red pre-split: 2 vs 1)

Follow-ups filed: HEL-1735 (feature stylesheets outside `shared/`), HEL-1736 (`useTopModalDialog` narrowing).

## Evidence notes (for the PR body)

- Touch e2e on UNCHANGED CSS, `realTap` primitive: RED in both themes for instances 1 (ActionsMenu trigger), 3 (Select trigger), 4 (compute function-reference `summary.disclosure-summary`; design's OutputSchemaDisclosure trigger is pipeline-owned and already gated, so it was mis-chosen), 5 (IconButton refresh) and 6 (`.ui-modal-btn` leave-guard "Keep editing"). 5 of 6 red.
- Instance 2 (ActionsMenu item, "Move step down", reopened by keyboard) is green on unchanged CSS: guard + probe only. The item is reopened under a stationary pointer, which Chrome does not repaint as hovered. Its rule is gated and guarded.
- Plain `tap()` (no compat mouse move) leaves instance 1 green on unchanged CSS: only `realTap` reproduces the sticky hover.
- The e2e blurs the control before reading: focus returns to a Select/popover trigger when its popup closes and paints a legitimate focus ring, which is not hover.
- After gating: all instances equal rest (touch), and desktop hover equals the values recorded from unchanged CSS in both themes.
- Guard red first: 38 ungated `:hover` selectors on unchanged CSS. Per-file mutation (un-gate the first rule in each of the 20 files) fails the guard naming that file each time; a mixed-list mutation fails the mixed-list test.
- 1280 gap assertion: base passes (gap 12 vs header gap 12); mutation `.spine-header__meta { flex: 0 0 auto }` fails (95 > 13).
- Premise correction: `useNow` keeps ONE shared setInterval per interval length, so the card's two hook calls were two subscriptions, not two timers.
