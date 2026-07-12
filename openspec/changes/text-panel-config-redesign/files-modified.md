## Backend

- `backend/src/main/scala/com/helio/domain/panels/TextPanel.scala` — `TextPanelConfig` gains `dataTypeId`/`fieldMapping` (mirrors `MetricPanelConfig`, jsonFormat3, tolerant decode/decodeCreate); `Patch` gains absent-vs-null `dataTypeId`/`fieldMapping` while keeping `content`'s existing absent/null-to-`""` semantics; `TextPanel.dataTypeId`/`fieldMapping`/`buildQuery` implemented for real; `withBindingCleared` clears only the binding, preserving literal `content` (Decision 1 divergence from Metric); `applyPatch` applies all three fields.
- `backend/src/main/scala/com/helio/infrastructure/PanelRowMapper.scala` — `domainToRow`'s `TextPanel` case now also writes `typeId`/`fieldMapping`; `textConfig` reads them back on the decode path.
- `schemas/panel.schema.json` — `TextConfig` def gains `dataTypeId`/`fieldMapping` properties (mirrors `MetricConfig`).
- `backend/src/test/scala/com/helio/domain/PanelSpec.scala` — updated "bound-capable" dispatch/query/withBindingCleared assertions to include Text; new `TextPanelConfig.dataTypeId/fieldMapping` describe block covering decode/Patch/applyPatch, including the bind-direction corollary (dataTypeId/fieldMapping patch alongside absent content leaves content untouched) and the Static-mode-clears-binding case.
- `backend/src/test/scala/com/helio/infrastructure/PanelRowMapperSpec.scala` (new) — round-trip coverage for a bound and an unbound Text panel through `domainToRow`/`rowToDomain`.

## Frontend

- `frontend/src/features/panels/types/panel.ts` — `TextPanelConfig` gains `dataTypeId`/`fieldMapping`; `emptyTextConfig` updated.
- `frontend/src/features/panels/state/panelNarrowing.ts` — `isBoundCapablePanel` widened to include `TextPanel`.
- `frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx` — additive `literalMultiline?: boolean` prop; renders a `Textarea` instead of `TextField` in literal mode when true (default `false`, no behavior change for Metric's Label/Unit).
- `frontend/src/features/panels/ui/editors/TextContentEditor.tsx` (new) — Text panel's Content editor (Source/Static mode toggle via `useBoundOrLiteralState` + `DataTypePicker` (Source-only) + `BoundOrLiteralField`); implements `PanelEditorHandle`.
- `frontend/src/features/panels/state/panelPayloads.ts` — new `buildTextBindingPatch` builder (Source mode omits `content` entirely from the patch — the bind-direction corollary; Static mode sets `content` and clears the binding); `seedCreateConfig`'s `"text"` case now seeds `dataTypeId` from the creation modal's selection (previously discarded).
- `frontend/src/features/panels/services/panelService.ts` — new `updatePanelTextBinding` service call.
- `frontend/src/features/panels/state/panelThunks.ts` — new `updatePanelTextBinding` thunk.
- `frontend/src/features/panels/state/panelsSlice.ts` — wires the new thunk's `fulfilled` case and re-export.
- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — wires `TextContentEditor` in (new `isTextPanel` branch in `activeEditorRef`/`renderSubtypeEditor`, new `textEditorRef`) — previously Text panels had no editor at all.
- `frontend/src/features/panels/ui/PanelCreationPreview.tsx` — `"text"` preview-config cast widened to include `dataTypeId`/`fieldMapping` (compile fix following the `TextPanelConfig` type change).
- `frontend/src/test/panelFixtures.ts` — `makeTextPanel` fixture seeds `dataTypeId`/`fieldMapping` defaults.

## Frontend tests

- `frontend/src/features/panels/hooks/usePanelData.test.ts` — new "bound Text panel" describe block (resolves `data.content`, unbound returns null, noData when the bound DataType has no rows).
- `frontend/src/features/panels/ui/editors/BoundOrLiteralField.test.tsx` — new `literalMultiline` describe block (textarea vs text field, field-mode unaffected, onChange propagation); existing Metric-shaped tests unmodified/still passing.
- `frontend/src/features/panels/ui/PanelContent.test.tsx` — regression tests: unbound Text panel with only literal `content` renders unchanged (no `data` prop); bound `data.content` takes precedence over literal `config.content` when both present.
- `frontend/src/features/panels/state/panelPayloads.test.ts` (new) — `buildTextBindingPatch` unit tests, including the explicit regression assertion that a Source-mode patch never carries a `content` key; `buildCreatePanelBody`'s `"text"` case seeds `dataTypeId`.
- `frontend/src/features/panels/ui/PanelDetailModal.textContent.test.tsx` (new) — integration tests through `PanelDetailModal` mirroring the `PanelDetailModal.labelUnit.test.tsx` pattern: mode-default heuristic (Source for bound, Static for unbound), DataType picker visibility gating, save payload shape for both modes (including the bind-direction corollary), discard/reset, and no-op save.
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` — new test mirroring the existing "4.5" metric test: creating a Text panel with a selected DataType calls `createPanel` with the selected `dataTypeId` (previously discarded).

## OpenSpec

- `openspec/changes/text-panel-config-redesign/tasks.md` — all 22 tasks marked complete.

## Cycle 2 — skeptic change request (visual-polish fix)

- `frontend/src/features/panels/ui/PanelDetailModal.css` — new `.panel-detail-modal__mapping-row--align-top` modifier (`align-items: flex-start`), scoped separately from the base `.panel-detail-modal__mapping-row` (`align-items: center`) so Metric's existing single-line Label/Unit rows are unaffected.
- `frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx` — the row `<div>` now conditionally applies `panel-detail-modal__mapping-row--align-top` when `literalMultiline` is true, fixing the Text `Content` label floating mid-height against the ~250px `Textarea` instead of aligning to its top edge (skeptic-final-1.md Change Request 1).
