## Why

HEL-306: a layout change staged on desktop (panel drag/resize) is silently dropped if the browser window
shrinks below 768px within the 30s flush window. `DesktopPanelGrid` unmounts on the crossing, `useLayoutSave`'s
staged refs are destroyed, and the parent flush slot is cleared — the PATCH never fires and restoring to
desktop does not recover the change. Residual edge documented in HEL-304 (PR #234, audit row 4).

## What Changes

- `useLayoutSave` flushes any staged-but-unpersisted layout change on unmount (before the flush-slot
  registration is cleared), so a desktop-staged edit survives the shrink below the `sm` boundary.
- The HEL-301/HEL-304 structural guarantee is unchanged: the mobile stack still never mounts any
  layout-write path, and a pure resize with no staged desktop change flushes nothing (equality guard).
- Regression tests cover: shrink-mid-edit flush, mobile-browsing-never-PATCHes-layout (existing HEL-301
  xs byte-identity guard must keep passing), and rapid repeated 768px boundary crossings.
- Repro-widening: re-verify the HEL-304 column-widths audit (column widths flow through
  `accumulatePanelUpdate` / `usePanelUpdatesFlush`, which is width-independent and already unmount-safe)
  and check other unmount-with-staged-state consumers of `useLayoutSave` state.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `frontend-layout-persistence`: staged layout changes must survive the desktop grid unmounting (viewport
  shrink below the `sm` boundary, dashboard switch, navigation) — flushed on unmount rather than dropped.

## Non-goals

- No restore-on-remount buffering (flush-on-unmount is chosen instead — see design.md).
- No changes to `usePanelUpdatesFlush` / panel-content flushing (already width-independent, HEL-304).
- No changes to mobile stack behavior or the `sm` breakpoint branching in `PanelGrid`.

## Impact

- `frontend/src/features/panels/hooks/useLayoutSave.ts` — flush-on-unmount effect.
- `frontend/src/features/panels/ui/DesktopPanelGrid.tsx`, `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts`
  — header-comment updates only (document the unmount flush in the hazard reasoning).
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` (or a sibling test file) — regression tests.
- No backend, schema, or API changes.
