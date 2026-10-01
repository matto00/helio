- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx` — stop handlers arm a pending-commit flag; handleLayoutChange commits the live layout to the store (zero-delay timer / next start disarm it)
- `frontend/src/features/panels/hooks/useLayoutSave.ts` — localCommitRef + commitInteractionLayout; resolvedLayout effect re-baselines by default, skips it only for the interaction commit and undo/redo (revision); persisted ref set on PATCH success; stuck-pending clear
- `frontend/src/features/layout/state/layoutHistorySlice.ts` — per-dashboard `revision` counter bumped by undo/redo, `selectLayoutRevision`
- `frontend/src/features/layout/state/layoutHistorySlice.test.ts` — revision tests; `revision` field in a hand-built history fixture
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.layoutCommit.test.tsx` — new unit tests (stop-before-change order, undo/redo/flush sequences, no-move, flag leak, panel-create re-baseline)
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.test.tsx` — test store gains the `layoutHistory` reducer now read by useLayoutSave (required wiring, not a behaviour change)
- `e2e/hel1028-layout-undo-redo-visual-revert.spec.ts` — real-browser spec: rendered boundingBox, keyboard + CommandBar, lg/sm, light/dark, resize, no-PATCH, xs documented
- `openspec/changes/fix-layout-undo-redo-grid-revert/{tasks.md,red-run.txt,green-run.txt,files-modified.md}` — task state and red/green evidence

Residue: none (59 throwaway users and 2 leftover dashboards deleted by exact id; ids in the executor report scratchpad h1028-user-ids.txt).
