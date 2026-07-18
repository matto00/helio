# Files modified — fix-panel-modal-stale-state (HEL-307)

## Root cause (systematic-debugging Iron Law)

- **Root cause (UI/component layer):** both production call sites render
  `<PanelDetailModal>` without a React `key`, so React reuses the mounted
  instance across `detailPanelId` changes; the modal's (and every subtype
  editor's) `useState(initial*)` seeds run only on mount and retain panel A's
  values while `panel.id` now points at B. `handleEditSubmit` then dispatches
  the stale appearance payload unconditionally against B's id — a data-corruption
  path, not just a display glitch.
- **Probe:** `npm test -- --testPathPatterns=PanelDetailModal.panelSwitch`
  against the unfixed code (new test drives the real `MobilePanelStack` call
  site, tapping panel A into edit mode then panel B without closing).
- **Probe output (unfixed):** after the A→B switch, `getByLabelText("Panel title")`
  read `"Panel A"` (expected `"Panel B"`), and a Save produced
  `pendingPanelUpdates["b"].appearance.background === "#111111"` (panel A's
  background) instead of B's `"#222222"` — confirming both the stale display and
  the cross-panel-save corruption. After adding the `key`, the same test passes.

## Source files

- `frontend/src/features/panels/ui/DesktopPanelGrid.tsx` — add `key={detailPanelId}`
  to the `PanelDetailModal` render so a direct panel switch remounts the modal
  subtree and re-seeds all form state from the target panel (the fix).
- `frontend/src/features/panels/ui/MobilePanelStack.tsx` — same `key={detailPanel.id}`
  fix at the mobile call site.
- `frontend/src/features/panels/ui/PanelDetailModal.panelSwitch.test.tsx` — new
  regression tests driving the real `MobilePanelStack` call site: (1) after a
  direct A→B switch every audited field group (title, background, text color,
  transparency, markdown content) shows B's persisted values; (2) a Save after
  the switch stages only B's own appearance under B's id, never A's. Both fail
  on the unfixed code (the `key` is under test) and pass after the fix.

## Field audit (task 2.3)

All modal form state is component-local `useState`/`useMemo` under the keyed
subtree — the modal's own atoms (title, background, color, transparency,
chartAppearance) and every subtype editor (`BindingEditor`, `MarkdownEditor`,
`TextContentEditor`, `ImageEditor`, `DividerEditor`, `CollectionEditor`) plus
`useBoundOrLiteralState`, `useChartDisplayState`, `useTableDisplayState`. No
module-level mutable state exists (`^let`/`^var` scan of the editors dir is
empty). The only Redux write path (`accumulatePanelUpdate` →
`pendingPanelUpdates`) is correctly keyed by `panelId`. `useChartDisplayState`
and `useTableDisplayState` additionally self-reseed via an internal
`${panel.id}|nonce` seed-key, so they were already robust to a panel-identity
change; the keyed remount is harmless additive coverage. No exception found —
the keyed remount covers every field.
