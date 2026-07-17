## Why

Panel appearance/title edits staged while the grid container is narrower than 768px are silently dropped: the
`pendingPanelUpdates` flush (30s interval, dashboard-switch flush, "Save now" registration) lives in
`usePanelGridSave`, which mounts only inside `DesktopPanelGrid` — but the producer (`PanelDetailModal`, mounted by
BOTH shells) and the pending Redux state are width-independent. Below 768px nothing ever flushes, "Save now" is a
dead button, and edits staged on desktop are stranded when the window is resized below 768px mid-edit (HEL-304).

## What Changes

- Adopt ticket remedy **(a)** — edits below 768px persist exactly like desktop. Remedy (b) (genuinely read-only
  mobile shell) cannot close the bug alone (the desktop resize-mid-edit strand remains) and its affordance-removal
  is HEL-303's scope.
- Hoist the pending-panel-updates flush lifecycle (interval, dashboard-switch flush, Save-now registration,
  imperative flush handle) out of `DesktopPanelGrid` to a width-independent owner mounted whenever a dashboard
  view renders (`PanelGrid` level, both branches).
- Layout persistence (`updateDashboardLayout` / `setLayoutPending`) stays structurally desktop-only inside
  `DesktopPanelGrid` — the HEL-301 xs byte-identity guarantee (no layout PATCH from the phone stack) is preserved
  and re-tested.
- Regression tests: appearance edit at phone width flushes via the batch endpoint; desktop edit survives a
  mid-edit resize below 768px; phone browsing still issues zero layout PATCHes; Save-now flushes at phone width.
- Mutation-path audit (every `usePanelGridSave`-dependent path) recorded in design.md and the PR body.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `panel-write-accumulator`: flush lifecycle MUST be viewport-width-independent — pending updates flush at any
  container width and survive shell switches (desktop grid ↔ mobile stack).
- `mobile-viewer-stack`: clarify the read-only guarantee is about layout writes; panel-field batch flush MUST
  operate below 768px while zero dashboard-layout PATCHes remain possible from the stack.
- `panel-save-state-indicator`: "Save now" MUST trigger the batch flush at all viewport widths.

## Non-goals

- Removing mobile edit affordances or styling polish of the <768px shell (HEL-303).
- Any change to layout persistence semantics, subtype-editor typed thunks, or backend endpoints.

## Impact

Frontend only: `usePanelGridSave.ts` (split), `PanelGrid.tsx`, `DesktopPanelGrid.tsx`, `PanelGrid.test.tsx` and
related tests. No API or schema changes.
