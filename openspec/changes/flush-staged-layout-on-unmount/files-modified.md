# Files modified — HEL-306 (flush-staged-layout-on-unmount)

## Source

- `frontend/src/features/panels/hooks/useLayoutSave.ts` — the fix: added a
  `persistLayoutRef` (updated every render via a no-dep effect, the
  `usePanelUpdatesFlush` latest-ref pattern) and a dedicated empty-dep unmount
  effect whose cleanup calls `persistLayoutRef.current()` exactly once at true
  unmount. Flushes any staged-but-unpersisted layout change directly (not via the
  parent slot). Header comment updated to document the unmount flush and why it
  preserves the HEL-301 structural guarantee.
- `frontend/src/features/panels/ui/DesktopPanelGrid.tsx` — header-comment update
  only: documents that the component fully unmounts on the `sm` crossing / a
  dashboard switch (keyed remount) and that `useLayoutSave` now flushes the
  staged layout on unmount.
- `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts` — header-comment
  update only: notes that the staged desktop layout is now persisted by
  `useLayoutSave`'s own unmount cleanup rather than being dropped when the
  boundary crossing empties the layout-flush slot.
- `frontend/src/features/panels/ui/PanelGrid.test.tsx` — added the HEL-306
  regression describe block (tests 3.1 shrink-mid-edit, 3.2 browse-only crossing,
  3.3 rapid repeated crossings). Existing HEL-301 / HEL-304 tests unmodified.

## Root cause (Iron Law: systematic-debugging)

- **Root cause:** UI/state layer — `useLayoutSave` (mounted only by
  `DesktopPanelGrid`) stages layout drags in `latestLayoutRef` but its unmount
  cleanup only cleared the parent flush slot (`registerLayoutFlush(null)`); it
  never flushed the staged change. When the viewport crosses below `sm` (768px)
  `PanelGrid` swaps in `MobilePanelStack`, `DesktopPanelGrid` unmounts, the hook
  instance (and `latestLayoutRef`) is destroyed, and the staged PATCH is lost.
- **Probe:** added regression test 3.1 (`flushes the staged layout exactly once
  when the width drops below 768px mid-edit`) and ran it against the unfixed
  code: `npx jest --testPathPatterns=PanelGrid.test -t "HEL-306"`.
- **Probe output (unfixed code):**
  ```
  ● PanelGrid › HEL-306 … › flushes the staged layout exactly once when the width drops below 768px mid-edit
    expect(jest.fn()).toHaveBeenCalledTimes(expected)
    Expected number of calls: 1
    Received number of calls: 0
  Tests: 2 failed, 21 skipped, 1 passed, 24 total
  ```
  Test 3.2 (browse-only crossing) passed unfixed, confirming the drop is specific
  to a staged change — not the crossing itself. After the fix all 24 pass.

## Repro-widening audit (tasks 4.1 / 4.2)

- **4.1 Column widths (HEL-304 re-verify):** column width / order / visibility
  edits flow through `useTableDisplayState` → `accumulatePanelUpdate` →
  `pendingPanelUpdates` → `usePanelUpdatesFlush`, which is owned by `PanelGrid`
  and mounts at **every** width. The shell swap below `sm` does not unmount it, so
  those edits are already unmount-safe — covered by the existing HEL-304 test
  "does not strand updates staged at desktop when the width drops below 768px".
  No code change needed.
- **4.2 Other unmount-with-staged-state consumers:** the only layout staging
  lives in `useLayoutSave` (`latestLayoutRef` + the `setLayoutPending` flag), used
  solely by `DesktopPanelGrid`. `MobilePanelStack.tsx` imports no layout-write
  path (comment-only reference, no `useLayoutSave` / `updateDashboardLayout` /
  `setLayoutPending`). The new empty-dep unmount effect fires on **every**
  `DesktopPanelGrid` unmount cause — `sm` boundary crossing, dashboard switch
  (`PanelList.tsx` keys `<PanelGrid>` by `selectedDashboardId` → true remount),
  and route navigation — so all staged-layout teardown paths are covered by the
  single mechanism.

## HEL-301 constraint

Preserved. The flush runs inside the desktop-only hook's teardown on
desktop-staged data only; a browse-only crossing is a no-op via `persistLayout`'s
equality guard (test 3.2). The xs byte-identity / structural no-persist guards and
the HEL-304 flush tests pass unmodified.
