## New files

- `frontend/src/features/panels/ui/editors/BoundOrLiteralField.tsx` — the reusable "bind to field, or
  fixed text" control (design.md Decision 2) — mode toggle + Select-or-TextField, plus the exported
  `defaultBoundOrLiteralMode` heuristic. This is the component HEL-244/245/247 copy directly.
- `frontend/src/features/panels/ui/editors/BoundOrLiteralField.test.tsx` — isolation tests: mode
  switching, the default-mode heuristic, controlled field/literal value propagation (task 1.2).
- `frontend/src/features/panels/ui/editors/MetricValueEditor.tsx` — Metric's unified Value control
  (field selector + Reduce selector), replacing the old field-mapping "Value" row + separate
  Aggregation section (design.md Decision 1).
- `frontend/src/features/panels/ui/editors/MetricValueEditor.test.tsx` — isolation tests for the
  Value control (Reduce options list, field/reduce onChange propagation).
- `frontend/src/features/panels/ui/editors/useBoundOrLiteralState.ts` — state + dirty-tracking +
  patch-shaping hook for one `BoundOrLiteralField` instance; extracted so `BindingEditor` doesn't
  duplicate six `useState`s and dirty comparisons per Label/Unit slot.
- `frontend/src/features/panels/ui/editors/useBoundOrLiteralState.test.ts` — hook tests (dirty
  tracking, patchValue absent/null/value semantics, reset()).
- `frontend/src/features/panels/ui/editors/ChartAggregationFields.tsx` — chart's Aggregation
  sub-section (group-by/value-field/agg-function), extracted out of `BindingEditor` to keep that file
  under the CONTRIBUTING.md file-size soft budget once metric's Aggregation section was replaced.
- `frontend/src/features/panels/ui/editors/FieldMappingSlots.tsx` — the generic per-`PANEL_SLOTS` loop
  (chart xAxis/yAxis/series, table columns), extracted out of `BindingEditor` for the same reason;
  metric no longer uses it.
- `frontend/src/features/panels/ui/editors/DataTypePicker.tsx` — the "Data type" search/select/clear
  section, extracted out of `BindingEditor` for the same reason (behavior-preserving extraction).
- `frontend/src/features/panels/ui/PanelDetailModal.labelUnit.test.tsx` — new integration test file
  covering literal label/unit round-trip through edit mode (set / change / clear), verifying the PATCH
  payload and the mode-default heuristic when opening a panel with an existing literal (task 4.2).

## Modified files

- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — metric branch replaces the generic
  `PANEL_SLOTS` field-mapping loop + separate "Aggregation" section with `MetricValueEditor` + two
  `BoundOrLiteralField` rows (Label, Unit); chart/table branches unchanged (now rendered via
  `FieldMappingSlots`/`ChartAggregationFields`, same markup/behavior). `aggField`/`aggFn` state is
  reused for metric's unified Value control (initial fallback extended to `fieldMapping.value` when no
  `aggregation` is present, matching `usePanelData.ts`'s render precedence). `save()` now derives
  metric's `fieldMapping` wholesale from the Value/Label/Unit controls' current state (the backend
  patch replaces `fieldMapping` entirely rather than merging) and threads `label`/`unit` through
  `updatePanelBinding` using the existing absent/null/value convention.
- `frontend/src/features/panels/state/panelPayloads.ts` — `buildBindingPatch` gains optional
  `label`/`unit` params, following the exact `aggregation` absent-omits/null-clears/value-sets
  convention already in place.
- `frontend/src/features/panels/state/panelThunks.ts` — `updatePanelBinding` thunk payload gains
  optional `label`/`unit`, threaded through to the service call.
- `frontend/src/features/panels/services/panelService.ts` — `updatePanelBinding` service function
  gains two more optional trailing params (`label`, `unit`), passed into `buildBindingPatch`.
- `frontend/src/features/panels/ui/PanelDetailModal.css` — new `.panel-detail-modal__mode-field` /
  `__mode-toggle` / `__mode-toggle-btn(--active)` classes for `BoundOrLiteralField`'s mode toggle,
  built from existing tokens (mirrors the app's established "selected chip" visual language, e.g.
  `.panel-detail-modal__chart-type-option--active`).
- `frontend/src/features/panels/ui/PanelDetailModal.aggregation.test.tsx` — metric-specific tests
  updated for the new unified Value control (no more separate "Aggregation" heading for metric); two
  new tests cover the `panel-viz-aggregation` spec scenarios ("selecting a reduce function moves the
  field to aggregation" / "selecting None moves it back"); chart tests unchanged.
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` — two existing
  `toHaveBeenCalledWith("p1", "dt-1", null, null, undefined)` assertions extended with two more
  trailing `undefined`s to match `updatePanelBinding`'s now-7-arg positional signature (mechanical
  fix; same call, same behavior — `label`/`unit` are unconditionally passed positionally so JS
  `arguments` includes them even when `undefined`, and Jest's `toHaveBeenCalledWith` does not ignore
  trailing-undefined arity differences). All other assertions in this file (including the "Value
  field"/"Label field"/"Unit field" aria-label checks) pass unmodified because `BoundOrLiteralField`'s
  aria-labels were deliberately named `"${label} field"` to match the old generic slot labels exactly.

## Root cause / probe (Iron Law — systematic-debugging)

Not a bug fix — this is a UI reorganization + additive plumbing change. No probe-confirmed root cause
applies; see "Modified files" above for the one mechanical test-signature consequence (extra trailing
`undefined` args) that required updating two pre-existing assertions.
