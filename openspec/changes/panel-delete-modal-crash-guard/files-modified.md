## Files modified

See `trigger-path-probe.md` for the widened trigger-path probe outcomes (ticket AC 4 / tasks.md
1.2): 4 paths, each with live evidence — 2 covered by `DesktopPanelGrid.test.tsx` + cycle-1
Playwright evidence, 2 probed fresh in cycle 2 (parent dashboard deletion: no crash, confirmed
live; bound DataType/pipeline deletion: not reachable while a panel is bound, confirmed live via
both the direct-DataType-delete `409` and the pipeline-delete-doesn't-cascade-to-type check).


- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` — replaced the non-null-asserted
  `panels.find((p) => p.id === detailPanelId)!` lookup with a derived `detailPanel: Panel | undefined`.
  Render guard: `PanelDetailModal` only mounts when `detailPanel` is defined. Added a `useEffect`
  (keyed on `[detailPanelId, detailPanel, panelsStatus]`) that clears `detailPanelId` only when the
  panel is confirmed absent AND `panelsSlice.status === "succeeded"` (excludes a transient
  loading/failed refetch window from permanently dismissing the modal). Added `useAppSelector` for
  `panelsSlice`'s `status`.
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.test.tsx` (new) — primary, gated regression
  coverage (Jest/`npm test`/CI): (1) modal unmounts + no throw when the backing panel is removed while
  open; (2) same, simulating a cross-actor removal; (3) transient loading/failed window doesn't crash
  and doesn't permanently clear `detailPanelId` — the modal reopens once the panel is confirmed present
  again after a successful reload.
