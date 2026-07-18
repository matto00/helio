# HEL-306 — Staged layout edit dropped when desktop window shrinks below 768px mid-edit

- **Type:** Bug
- **Priority:** Low
- **Project:** Helio Mobile — PWA
- **URL:** https://linear.app/helioapp/issue/HEL-306/staged-layout-edit-dropped-when-desktop-window-shrinks-below-768px-mid

## Context

Residual pre-existing edge documented during HEL-304 (PR #234, audit row 4). HEL-304 made panel-content mutations (appearance, title, subtype config) flush width-independently via `usePanelUpdatesFlush`, but **layout** writes deliberately stayed structurally desktop-only (`useLayoutSave` in `DesktopPanelGrid`) to preserve the HEL-301 guarantee that mobile browsing never PATCHes dashboard layout.

## Observed

On desktop, drag a panel (staging a layout change), then shrink the browser window below 768px within the 30s flush window: the desktop grid unmounts and the staged layout change is dropped without error. Restore-to-desktop does not recover it.

## Expected

The staged layout change either flushes before the grid unmounts (e.g. flush-on-unmount of `useLayoutSave`) or is preserved and flushed when the desktop grid remounts — without ever allowing a PATCH originated from mobile browsing (HEL-301 xs byte-identity guard must keep passing).

## Repro-widening note

Check the same unmount-with-staged-state pattern for anything else `useLayoutSave` stages (column widths were audited in HEL-304 — re-verify after any fix here), and check rapid repeated crossings of the 768px boundary.

## Acceptance criteria

- [ ] A layout change staged on desktop survives a window shrink below 768px within the flush window (flushed or restored on remount)
- [ ] HEL-301 regression guard still passes: browsing on mobile never PATCHes dashboard layout
- [ ] Regression test covering the shrink-mid-edit path

## Session directives (from the human operator)

- Iron Laws: probe-confirm the drop (stage a layout change, shrink below 768px within the window, confirm the PATCH never fires and the change is lost) before fixing.
- The fix must flush-on-unmount OR restore-on-remount WITHOUT ever allowing a PATCH that originates from mobile browsing. The HEL-301 xs byte-identity guard MUST keep passing — verify it explicitly.
- Study the HEL-304 split (`usePanelUpdatesFlush` width-independent content edits vs `useLayoutSave` desktop-only layout) before touching it; this ticket extends the layout half only.
- Verification requires desktop→<768px resize scenarios AND the HEL-301 mobile-never-PATCHes-layout guard.
- Operational hygiene: Playwright screenshots go to the session scratchpad or gitignored tmp — NEVER the repo root. Never bulk-delete by glob. HEL-308 cleanup may briefly run in parallel — stay inside this worktree and ports 5479/8386.
