# Fix PanelDetailModal stale form state on direct panel switch

## Why

Switching directly from panel A's open edit form to panel B (without closing the modal) shows A's stale
form values in B's form (HEL-307). Worse than a display glitch: `handleEditSubmit` dispatches the staged
appearance payload unconditionally against the *current* `panel.id`, so saving in that state writes A's
title/appearance onto B — a data-corruption path.

## What Changes

- Re-initialize all `PanelDetailModal` form state when the target panel's id changes. Root-cause
  hypothesis (to be probe-confirmed per the systematic-debugging Iron Law): both call sites
  (`DesktopPanelGrid.tsx:286`, `MobilePanelStack.tsx:129`) render `<PanelDetailModal>` without a
  `key`, so React reuses the mounted instance across `detailPanelId` changes and every
  `useState(initial*)` — in the modal and in every subtype editor (BindingEditor, Markdown/Text/
  Image/Divider/Collection editors, BoundOrLiteralField/useBoundOrLiteralState,
  useChartDisplayState, useTableDisplayState) — keeps A's values. Intended fix: `key={panel.id}` at
  both call sites, remounting the whole modal tree (modal mode, dirty flags, and all editor state
  reset in one move; the mount `showModal()` effect re-runs).
- Audit every form field in the modal (title, appearance, chart appearance, binding/dataTypeId,
  refresh interval, aggregation, per-subtype config sections) to confirm the keyed remount covers
  them all — no field-level patching left behind.
- Regression test covering the direct-switch path: form shows B's values after switch, and a save
  after a switch can never carry A's staged values onto B.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `panel-detail-modal`: add a requirement that the modal's form state always reflects the panel it
  is currently showing — switching the target panel re-initializes every form field, and Save only
  writes values staged for the currently shown panel.

## Impact

- `frontend/src/features/panels/ui/DesktopPanelGrid.tsx`, `MobilePanelStack.tsx` (add `key`).
- New regression test file for the direct-switch path.
- No backend, schema, or API changes. No CSS changes (HEL-309 owns PanelDetailModal.css churn).

## Non-goals

- Preserving unsaved edits across a direct panel switch (discard-on-switch matches the
  close-then-reopen behavior users already get).
- Any restructure of PanelDetailModal state management or CSS (HEL-309 handles the CSS split).
- Changing the discard-warning flow or modal lifecycle beyond the keyed remount.
