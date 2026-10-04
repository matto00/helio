- `frontend/src/features/layout/state/layoutHistoryThunks.ts` (new) — single undo/redo entry (`applyLayoutUndo`/`applyLayoutRedo`)
- `frontend/src/features/layout/state/layoutHistorySlice.ts` — per-dashboard `applied` layout + `selectAppliedLayout`
- `frontend/src/features/layout/hooks/useLayoutUndoRedo.ts` — shortcuts call the thunks
- `frontend/src/app/CommandBar.tsx` — buttons call the thunks; duplicate handlers/selectors removed
- `frontend/src/features/panels/hooks/useLayoutSave.ts` — four-way store-write classification (header = contract), traversal needs revision AND applied, placement extension, pending recomputed after PATCH response
- `frontend/src/features/panels/hooks/layoutPlacement.ts` (new) — placement-extension detection + baseline extension
- `frontend/src/features/panels/hooks/usePanelUpdatesFlush.ts` — header pointer only
- `frontend/src/features/dashboards/state/dashboardsSlice.ts` — required `sentLayout` arg; fulfilled reducer keeps a newer local layout by reference
- `frontend/src/features/layout/README.md`, `CLAUDE.md`, `openspec/specs/write-path-audit/spec.md` (free text only), `openspec/specs/frontend-layout-persistence/spec.md` (Purpose, planning edit) — 250ms debounce wording corrected
- `frontend/src/features/layout/state/layoutHistoryThunks.test.ts` (new) — thunk behaviour tests
- `frontend/src/features/layout/state/layoutHistorySlice.test.ts` — `applied` tests
- `frontend/src/app/CommandBar.test.tsx` — button versus shortcut parity
- `frontend/src/features/dashboards/state/dashboardsSlice.test.ts` — reducer both branches, new arg
- `frontend/src/features/dashboards/state/dashboardsSlice.layoutReject.test.ts` — new arg
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.layoutCommit.test.tsx` — flipped drag-then-create; 4.2/4.3/2.2
- `frontend/src/features/panels/ui/grid/DesktopPanelGrid.inflightResponse.test.tsx` (new) — 3.2 and accepted-race pin
- `e2e/hel1230-drag-then-create-persists.spec.ts` (new) — drag -> Add panel -> Save now PATCH body carries the dragged x

## Red/green evidence
Red = HEAD versions of `useLayoutSave.ts` + `dashboardsSlice.ts` restored with the new tests kept; green = current code.
- 2.2 `a no-op undo (target is the reference-identical current layout) cannot capture a later server layout` — RED: `Expected number of calls: 0, Received: 1`; GREEN.
- 3.2 `a drag made while the PATCH is in flight survives the response...` and `an undo made while ...` — RED: `isPending() Expected: true, Received: false` (response overwrote newer layout); GREEN. Accepted-race pin also red on HEAD (pending false) / green now.
- 4.1 `drag then a panel create before flush: the drag stays pending and the flush PATCHes it` (+ resize/undo-redo variants) — RED: `hasPendingLayout Expected: true, Received: false`; 4.2 overlap test RED (`Expected number of calls: 1, Received: 0`); GREEN.
- Summary of red run: `Tests: 8 failed, 14 passed, 22 total` (layoutCommit + inflightResponse suites); green: `Tests: 22 passed, 22 total`.
- e2e `hel1230-drag-then-create-persists.spec.ts`: RED on HEAD code (timed out, no PATCH sent: drag lost); GREEN on current code. `hel1028-layout-undo-redo-visual-revert.spec.ts` green unchanged (13 passed together with the new spec's first run).
- Finding while writing the e2e: a drag dropped onto the cell the server then places the new panel in is sent as the valid render-time reflow (HEL-1071/1023 substitution), i.e. the user-visible layout, not the raw dragged cell. Covered by the 4.2 unit test; the e2e drags in x only.

## Gate results (all run fresh in the worktree, nice -n 19)
- `npm run lint` exit 0; `npm run format:check` exit 0; `npm run typecheck` exit 0; `npm --prefix frontend run build` exit 0
- `npm test`: root 35 suites/350 tests passed; frontend 413 suites/4304 tests passed; exit 0
- Backend untouched (`git diff --stat -- backend` empty); no migration; no sources/connectors files.
## Notes / residue
- Servers started via start-servers.sh on 6662/9569 (cwd verified = this worktree), then killed by exact pid.
- Dev DB residue: e2e registers users `hel1230-<ts>-<rand>@example.test` (no delete-user API; same pattern as hel1028). Dashboard/pipeline/data-source rows were deleted by exact id in the spec's `finally`; the dashboards created in the two spec runs (including the red run) were deleted the same way.
- Task 6.2 fallback not needed: the e2e seeds the Output via API and is deterministic.
