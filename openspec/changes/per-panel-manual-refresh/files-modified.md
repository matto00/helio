# Files Modified — HEL-579 per-panel-manual-refresh

- `frontend/src/features/panels/hooks/usePanelData.ts` — adds the shared `inFlightRef` in-flight
  guard (mutated synchronously inline in `refresh()` and the fetch effect's dispatch/`.finally()`,
  design.md D2) and the new `isRefreshing` field (design.md D3), distinct from `isLoading`.
- `frontend/src/features/panels/hooks/usePanelData.test.ts` — red-first in-flight-guard test (task
  1.2: a second `refresh()` while the first's fetch is pending is a no-op; a third after it settles
  dispatches again) and an `isRefreshing` test (task 1.4) proving it tracks any pending fetch
  independent of `isLoading`.
- `frontend/src/features/panels/ui/PanelCard.tsx` — lifts the sole `usePanelData(panel)` call site
  from `PanelCardBody` up to `PanelCard` (design.md Decision 1); `PanelCardBody` now receives fetch
  state as individual props (not a spread object); adds the header Refresh `IconButton`
  (`RotateCw`/`Spinner` swap, `disabled={isRefreshing}`, gated on `outputId != null`), with a
  `panel-grid-card__refresh-btn` class hook for the circular-shape CSS fix below.
- `frontend/src/features/panels/ui/grid/PanelGrid.css` — adds a circular-radius override for
  `.panel-grid-card__refresh-btn`, matching the existing circular `ActionsMenu` trigger and drag
  handle in this header row (found via the required running-dev-server visual check, task 3.1 —
  the new button initially rendered as a rounded square, a real DESIGN.md §5/§7 cohesion defect
  against its two circular neighbors).
- `frontend/src/features/panels/ui/grid/MobilePanelStack.tsx` — a design.md gap: `MobilePanelStack`
  is a SECOND top-level caller of `PanelCardBody` (the phone read-only stack), independent of
  `PanelCard`, not mentioned in design.md/tasks.md. Adds a small `MobileStackPanelBody` wrapper
  component (mirroring `PanelCard`'s own `usePanelData` call + individual-props passthrough) so this
  caller keeps working under `PanelCardBody`'s new props-only contract; no new UI, no behavior
  change for this read-only surface (no Refresh control renders here).
- `frontend/src/features/panels/ui/PanelCard.test.tsx` — adds `isRefreshing: false` to existing
  mocked `usePanelData` returns; adds new coverage for tasks 2.5 (no control for
  markdown/image/divider/form panels), 2.6 (activation calls `refresh()`; disabled while refreshing
  is a no-op), 2.7 (keyboard-reachable native-button check, matching this repo's established
  `@testing-library/user-event`-free convention), and 2.8 (prop reference-stability across an
  unrelated `PanelCard` re-render, using the REAL `usePanelData` hook via `jest.requireActual` since
  the file's own mocked hook returns a fresh object/`jest.fn()` every call and can't exercise real
  `useCallback`/`useMemo` stability). Also adds a file-level `usePanelRunRefresh` mock (matching
  `PanelCardBody.fanoutStatus.test.tsx`'s existing convention) so `useOutputMeta`'s own unrelated
  internal async state doesn't confound the 2.8 render-count assertions.
- `frontend/src/features/panels/ui/PanelCardBody.predispatch.test.tsx` — `PanelCardBody` no longer
  calls `usePanelData` itself; adds a `PanelCardBodyHarness` component (playing `PanelCard`'s role —
  the single call site) so this test keeps driving a real store + `panelsReducer`.
- `frontend/src/features/panels/ui/PanelCardBody.fanoutStatus.test.tsx` — same harness pattern as
  above, for the fan-out-refresh sr-only announcement tests.
- `frontend/src/features/panels/ui/detailModal/PanelDetailModal.panelSwitch.test.tsx` — adds
  `isRefreshing: false` to the existing mocked `usePanelData` return (new required field).
- `frontend/src/features/panels/ui/grid/MobilePanelStack.test.tsx` — adds `isRefreshing: false` to
  the two existing mocked `usePanelData` returns (new required field).
- `openspec/changes/per-panel-manual-refresh/tasks.md` — all 15 tasks marked complete.
