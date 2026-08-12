## Files modified

Note: this branch has no commits yet on top of `main`, so `git diff --name-only
main...HEAD` is empty — the list below is from `git status --short` (working-tree
changes) instead.

### New — Metrics feature

- `frontend/src/features/metrics/types/metric.ts` — `Metric`/`MetricSummary`/`MetricFormat`/
  `CreateMetricRequest`/`UpdateMetricRequest` types mirroring the backend wire shape.
- `frontend/src/features/metrics/services/metricService.ts` — CRUD calls over `httpClient`,
  normalizing an absent `description` to `null` at the boundary.
- `frontend/src/features/metrics/services/metricService.test.ts` — one test per exported function.
- `frontend/src/features/metrics/state/metricsSlice.ts` — `createAsyncThunk` per CRUD op, flat
  `items`, per-op status/error, `createModalOpen` (mirrors `pipelinesSlice`).
- `frontend/src/features/metrics/state/metricsSlice.test.ts` — per-thunk reducer + thunk sub-suites.
- `frontend/src/features/metrics/ui/MetricsPage.tsx` + `MetricsPage.css` — list page (`/metrics`):
  fetch-on-mount, loading/empty/error, list table, "New metric" affordance.
- `frontend/src/features/metrics/ui/MetricListTable.tsx` — raw-`<table>` list rows with inline
  delete-confirm (mirrors `PipelineListTable.tsx`).
- `frontend/src/features/metrics/ui/MetricEmptyState.tsx` — `EmptyState` wrapper.
- `frontend/src/features/metrics/ui/CreateMetricModal.tsx` — "New metric" modal wrapping
  `MetricEditorForm` (mirrors `CreatePipelineModal.tsx`).
- `frontend/src/features/metrics/ui/MetricEditorForm.tsx` — shared create/edit form: name,
  description, DataType picker (reused), measure field, aggregation, allowed dimensions, format,
  deprecate toggle (edit only); surfaces backend errors inline near the name field; edit-mode PATCHes
  only the fields that actually changed.
- `frontend/src/features/metrics/ui/MetricEditorForm.css`
- `frontend/src/features/metrics/ui/MetricEditorForm.test.tsx` — create/edit happy path,
  DataType-constrained pickers, inline 400/422 error display.
- `frontend/src/features/metrics/ui/AllowedDimensionsPicker.tsx` + `.css` — new checkbox-list-in-a-
  popover multi-select (design.md D3), built on the existing `usePortalPopover` hook.
- `frontend/src/features/metrics/ui/MetricDetailPage.tsx` + `MetricDetailPage.css` — edit page
  (`/metrics/:id`): fetch-on-mount, loading/error guard, embeds `MetricEditorForm`, delete with
  inline confirm.

### New — Shared `Toggle` primitive

- `frontend/src/shared/ui/Toggle.tsx` + `.css` — checked/onChange/label/disabled switch primitive
  (no switch/checkbox existed in `shared/ui/` before this).
- `frontend/src/shared/ui/Toggle.test.tsx`
- `frontend/src/shared/ui/index.ts` — export `Toggle`.

### New — Panel binding editor, bind-to-metric mode

- `frontend/src/features/panels/ui/editors/useMetricBindingState.ts` — owns the bind-to-metric
  mode's selection/dirty/patch-value state (mirrors `useBoundOrLiteralState.ts`'s shape), gated to
  metric/chart/table panels.
- `frontend/src/features/panels/ui/editors/MetricPicker.tsx` — the picker UI; for metric panels
  (`showResolvedFields`) also renders the selected metric's measure/aggregation/format read-only.
- `frontend/src/features/panels/ui/editors/BindingEditor.metricBinding.test.tsx` — new split-file
  test: metric-panel resolved-fields materialization + clear-reveals-raw-fields; chart/table panels
  keep field-mapping controls independently editable after binding a metric; collection/timeline
  panels never mount this mode (they use separate editor components entirely).

### Modified — panel binding editor & wire plumbing

- `frontend/src/features/panels/types/panel.ts` — `metricId?: string | null` added to
  `MetricPanelConfig`/`ChartPanelConfig`/`TablePanelConfig`.
- `frontend/src/features/panels/state/panelPayloads.ts` (+ `.test.ts`) — `buildBindingPatch` accepts
  and forwards an optional `metricId` (absent/null/value convention).
- `frontend/src/features/panels/services/panelService.ts` — `updatePanelBinding` gains a trailing
  optional `metricId` param, forwarded into the PATCH body.
- `frontend/src/features/panels/state/panelThunks.ts` — `updatePanelBinding` thunk accepts/forwards
  `metricId`.
- `frontend/src/features/panels/ui/editors/MetricBindingFields.tsx` — composes `MetricPicker`; hides
  the Field/Reduce editor while a metric is selected, reveals it again when cleared.
- `frontend/src/features/panels/ui/editors/BindingEditor.tsx` — wires `useMetricBindingState` into
  dirty/reset/save; renders `MetricPicker` (no resolved-fields materialization) for chart/table
  panels.
- `frontend/src/features/panels/ui/PanelDetailModal.binding.css` — `.panel-detail-modal__metric-
  resolved*` styles for the read-only resolved-fields block.
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` +
  `PanelDetailModal.aggregation.test.tsx` — updated pre-existing exact-arg-count
  `toHaveBeenCalledWith(...)` assertions for `updatePanelBinding`'s new trailing `metricId` param.

### Modified — nav wiring, routes, store, test infra

- `frontend/src/shared/chrome/navDestinations.ts` (+ `.test.ts`) — new `/metrics` "Metrics" entry
  (`Gauge` icon).
- `frontend/src/shared/chrome/SidebarBody.tsx` (+ `.test.tsx`) — `section === "metrics"` branch
  (mirrors the `"pipelines"` branch) and `sectionFromPathname` handling.
- `frontend/src/shared/chrome/BottomNav.test.tsx` — updated hardcoded label list for the new tab.
- `frontend/src/app/App.tsx` (+ `.test.tsx`) — `/metrics` + `/metrics/:id` routes; `breadcrumbLabel`;
  mobile `breadcrumbItemName`/`mobileSheetItems`/`mobileSheetEmptyMessage`/`handleMobileSheetSelect`
  "metrics" handling.
- `frontend/src/store/store.ts` — registers `metricsReducer`.
- `frontend/src/test/renderWithStore.tsx` — registers the `metrics` slice + preloaded-state shape for
  tests.
- `frontend/src/test/panelFixtures.ts` — `makeMetricPanel`/`makeChartPanel`/`makeTablePanel` forward
  `config.metricId`.
- `frontend/vite.config.ts` — raised `workbox.maximumFileSizeToCacheInBytes` to 4 MiB; the app's
  single main JS chunk (no route-level code-splitting yet) crossed the PWA plugin's 2 MiB default
  precache limit once this ticket's code landed, failing `vite build` outright (root cause: bundle
  was already at ~2.04 MiB pre-ticket, this change added ~20 KB). See "Blockers/notes" in the final
  report.

### Cycle 2 (evaluation-1.md change request 1) — Escape-key data-loss fix

- `frontend/src/features/metrics/ui/AllowedDimensionsPicker.tsx` — trigger `<button>` gains an
  `onKeyDown` handler (`handleTriggerKeyDown`): on `Escape` while the popover `isOpen`, calls
  `event.preventDefault()` then `close()`, mirroring `Select.tsx`'s `handleKeyDown` Escape branch.
  Without `preventDefault()`, the keydown's native default action still reached `Modal.tsx`'s
  underlying native `<dialog>` (native "ESC closes" behavior) and closed the whole parent modal,
  discarding all in-progress form state.
- `frontend/src/features/metrics/ui/AllowedDimensionsPicker.test.tsx` — new file; the diagnostic
  regression guard (see "Root cause / probe" below for why this is the assertion that actually
  catches the bug, not a "press Escape, check the modal" one, in this jsdom environment).
- `frontend/src/features/metrics/ui/CreateMetricModal.test.tsx` — new file; the integration-shape
  test the evaluator's report described (full Create-metric-modal flow: fill name → select DataType
  → open Allowed dimensions → Escape → assert popover-only-closed, `onClose` never called, name value
  survives).

## Root cause / probe (systematic-debugging law)

**Bug 1 — `vite build` failing after this change's code landed:**
- **Root cause:** the app's single main JS chunk (no route-level code-splitting) was already at
  ~2093.91 KB before this ticket; this ticket's new code pushed it to ~2114.17 KB, crossing
  `vite-plugin-pwa`'s default 2 MiB (`2097152` byte) `workbox.maximumFileSizeToCacheInBytes` precache
  limit, which throws during the SW-generation build step.
- **Probe:** `git stash --include-untracked` (revert to the pre-ticket working tree) then
  `npm --prefix frontend run build` → succeeded, reporting `dist/assets/index-BPbL9VVV.js
  2,093.91 kB`. `git stash pop` then re-running the same build reproduced the failure with
  `dist/assets/index-DYtlS-k4.js 2,114.17 kB`, i.e. ~20 KB over what the pre-ticket build already
  used.
- **Fix:** raised `workbox.maximumFileSizeToCacheInBytes` to 4 MiB in `vite.config.ts` (the
  officially-suggested remedy in the plugin's own error message). Re-ran `npm --prefix frontend run
  build` fresh — succeeds (`precache 15 entries (2248.35 KiB)`).

**Bug 2 — `Toggle.test.tsx`'s disabled-click test failing:**
- **Root cause:** jsdom's `fireEvent.click()` on a native `<input type="checkbox" disabled>` does not
  gate the resulting `change` event the way a real browser does — the click's default "toggle
  checked + fire change" activation behavior fires regardless of the `disabled` attribute in this
  test environment.
- **Probe:** a minimal standalone probe — `render(<input type="checkbox" disabled onChange={onChange}
  />)` then `fireEvent.click(input)` — logged `onChange called: 1` and `input.checked: true`,
  confirming the behavior is a jsdom/React-testing-environment characteristic, not specific to the
  `Toggle` component.
- **Fix:** the test now asserts the `disabled` HTML attribute (`toBeDisabled()`), which is the actual
  contract a real browser honors, instead of relying on jsdom's non-authoritative click-gating.

**Bug 3 (cycle 2) — `AllowedDimensionsPicker`'s missing Escape containment (evaluation-1.md CR 1):**
- **Root cause:** the trigger `<button>` had no `onKeyDown` handler, so a cancelable Escape keydown
  was never `preventDefault()`-ed; its native default action reached `Modal.tsx`'s underlying native
  `<dialog>` (native "ESC closes" behavior), closing the whole parent modal and discarding
  in-progress form state. `Select.tsx` (the pattern `AllowedDimensionsPicker` was built to match)
  does not exhibit this bug because its own trigger's `handleKeyDown` calls `preventDefault()` on
  Escape — `AllowedDimensionsPicker` copied the portal/positioning mechanics of that pattern but not
  the keyboard-containment half.
- **Probe (three parts):**
  1. A standalone jsdom-only probe (bare `<dialog>` + `showModal()`, a `close` listener, dispatching a
     real cancelable `Escape` `KeyboardEvent` at a focused descendant button, and again directly at
     the `<dialog>`) confirmed **jsdom does not implement native `<dialog>` Escape-to-close at all** —
     `dialog.hasAttribute("open")` stayed `true` and no `close`/`cancel` event fired in either case,
     regardless of `preventDefault`. This matches `Modal.test.tsx`'s own existing workaround for the
     same gap (its "ESC key" test fires a synthetic `close` `Event` directly rather than a real
     keypress) — confirming an "Escape-then-assert-modal-still-open" test would pass unconditionally
     in this environment, fix or no fix, and would not be a valid regression guard.
  2. Given jsdom's limitation, the actually-diagnostic assertion is on `fireEvent.keyDown`'s return
     value: DOM's `dispatchEvent` returns `false` exactly when a cancelable event's
     `preventDefault()` was called — the same mechanism that stops the keydown from reaching the
     `<dialog>` in a real browser. Wrote `AllowedDimensionsPicker.test.tsx` asserting this return
     value is `false` after Escape while the popover is open.
  3. Verified both ways: temporarily reverted the `onKeyDown` addition and re-ran
     `AllowedDimensionsPicker.test.tsx` + `CreateMetricModal.test.tsx` — the `preventDefault`-return
     assertion **failed** (`Expected: false, Received: true`) as expected; the integration-shape
     `CreateMetricModal.test.tsx` test **passed regardless** (confirming point 1 — it cannot catch
     this regression in jsdom). Restored the fix and re-ran both — all 7 tests pass.
- **Fix:** `handleTriggerKeyDown` added to `AllowedDimensionsPicker.tsx`'s trigger, mirroring
  `Select.tsx`'s `handleKeyDown` Escape branch exactly (`event.preventDefault()` then `close()`).
