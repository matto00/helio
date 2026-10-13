# HEL-1418: Apply the processed-width wait to other live-resize e2e specs; split DesktopPanelGrid.tsx (~428 lines)

## Description

origin_kind: followup
origin_ticket: HEL-1413

HEL-1413 (96f2ae97) root-caused the hel1023 flake: specs that wait on `.panel-grid`'s CSS box width measure before
React Grid Layout has received the new width (ResizeObserver → rAF → setWidth). The fix exposes
`--panel-grid-processed-width` (fed by RGL `onWidthChange`, observability only) and waits on it.

1. Audit other e2e specs that resize live and gate on the CSS box width; switch them to the processed-width wait (a
   shared helper in e2e/support), and grep for the pattern as proof.
2. Split `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` (~428 lines) behaviour-preserving (HEL-1365
   standard).
3. Wording nits in the archived HEL-1413 `evidence.md`: all 8 items were at lg geometry (4 outside md bounds), not
   "4/8 stale"; the residue window ends at 16:04:07.

## Acceptance Criteria

- AC1: A shared processed-width wait helper exists in `e2e/support/`; every e2e spec that resizes the viewport live
  (after the page is loaded) and then gates on desktop-grid geometry/width uses it; the two existing inline copies
  (hel1023, hel1392-remount-request-burst) are replaced by it.
- AC2: An audit of every `setViewportSize` call in `e2e/` is recorded (each classified: live-resize-then-measures-RGL
  → migrated; pre-load / phone-only / non-grid → left, with reason), and a grep proves no inline
  `--panel-grid-processed-width` read and no CSS-box-width gate remains outside the helper.
- AC3: Any e2e wait whose semantics change is shown red (old wait racy, e.g. under the HEL-1413 delayed-ResizeObserver
  probe) before the fix and green after.
- AC4: `DesktopPanelGrid.tsx` is split behaviour-preserving to under ~250 lines; every existing DesktopPanelGrid*/
  PanelGrid* unit test passes unmodified; HEL-1525 invariant I1 (a save never claims a newer layoutVersion than its
  layout's source) and HEL-1457 rebase-on-409 are preserved (`useLayoutSave` is untouched and still called only from
  DesktopPanelGrid.tsx).
- AC5: The archived HEL-1413 `evidence.md` wording nits are corrected against ground truth.

## Driver constraints (from the run brief)

- Worktree cut from origin/main at 9c569fc60 or later. Stay out of backend test infrastructure (HEL-1544 in flight).
- Rendered Concertino files are gitignored; never edit or `git add` them.
- Throwaway @example.test users only, registered via the `request` fixture, deleted by exact (id, email) with
  `e2e/support/userCleanupCore.cjs` `buildUserDeleteSql`. Never act as matt@helio.dev.
