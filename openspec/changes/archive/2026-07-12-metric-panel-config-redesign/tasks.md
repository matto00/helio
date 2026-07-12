## 1. Frontend — shared field-or-literal component

- [x] 1.1 Create `BoundOrLiteralField.tsx` in `frontend/src/features/panels/ui/editors/` — mode
      toggle (bind-to-field / fixed-text) + `Select`/`TextField` per design.md Decision 2, following
      DESIGN.md §5 button recipes for the toggle.
- [x] 1.2 Unit test `BoundOrLiteralField` in isolation: mode switching, default-mode heuristic
      (literal-if-set), controlled value propagation.

## 2. Frontend — Metric value control

- [x] 2.1 Create `MetricValueEditor.tsx` in `frontend/src/features/panels/ui/editors/` — one field
      select + one Reduce select (`None (first row)` / Count / Sum / Average / Min / Max), per
      design.md Decision 1.
- [x] 2.2 Update `BindingEditor.tsx` to render `MetricValueEditor` + two `BoundOrLiteralField`
      (Label, Unit) for `panel.type === "metric"`, replacing the generic `PANEL_SLOTS` field-mapping
      loop and the Aggregation section for that branch only — chart/table branches unchanged.
- [x] 2.3 Initialize `MetricValueEditor`'s field/reduce state from `aggregation` when present,
      falling back to `fieldMapping.value` when absent (matches existing render-precedence in
      `usePanelData.ts`).
- [x] 2.4 Initialize each `BoundOrLiteralField`'s mode from `config.label`/`config.unit` (literal) vs
      `fieldMapping.label`/`fieldMapping.unit` (field), per design.md Decision 2/4.
- [x] 2.5 Wire `MetricValueEditor`/`BoundOrLiteralField` onChange handlers into `BindingEditor`'s
      existing dirty-tracking and `save()` so switching Reduce clears the other of
      `fieldMapping.value`/`aggregation`, and switching a Label/Unit mode clears the other of
      `fieldMapping.<slot>`/`config.<slot>`.

## 3. Frontend — update path plumbing

- [x] 3.1 Extend `buildBindingPatch` (`panelPayloads.ts`) with optional `label`/`unit` params
      following the existing `aggregation` absent/null/value convention.
- [x] 3.2 Extend `updatePanelBinding` thunk (`panelThunks.ts`) and service function
      (`panelService.ts`) with the same two optional params, threaded through to `buildBindingPatch`.
- [x] 3.3 Update `BindingEditor`'s `save()` to pass `label`/`unit` (dirty-only, `undefined` when
      untouched — mirrors the existing `aggregationDirty` guard pattern).

## 4. Tests

- [x] 4.1 Update/extend `PanelDetailModal.aggregation.test.tsx` (or add a sibling test file) to
      cover: selecting a Reduce function moves the field from `fieldMapping.value` to `aggregation`
      and clears the other; selecting "None" moves it back.
- [x] 4.2 Add tests covering literal label/unit round-trip through edit mode: set, change, clear —
      verifying the PATCH payload and re-render.
- [x] 4.3 Regression-check existing metric tests (`MetricRenderer.test.tsx`,
      `PanelDetailModal.test.tsx`, `panelsSlice.test.ts`, `usePanelData.test.ts`) still pass
      unmodified — no behavior change to rendering or resolution, only to the editor UI.
- [x] 4.4 Run `npm run lint` and `npm test` (frontend) to confirm zero-warnings + full suite green.
