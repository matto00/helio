## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Read ticket, proposal, design, tasks, spec delta; read useLayoutSave.ts, DesktopPanelGrid.tsx, useLayoutUndoRedo.ts, layoutHistorySlice.ts, dashboardsSlice.ts, panelThunks.ts.
- RGL 2.2.x source (node_modules/react-grid-layout/dist/chunk-7ZM5LVH2.mjs): onDragStop (l.796-833) / onResizeStop (l.931-956) call onDragStopProp/onResizeStopProp FIRST, then synchronously call onLayoutChange(finalLayout) iff the layout moved (l.826, 953). So the pending-commit flag design is correct, and the zero-delay clear for a no-move drag is sound (no deferred onLayoutChange needed). The Responsive sync effect (l.1440ish/propsLayouts deepEqual) matches the root-cause claim.
- Undo handlers (useLayoutUndoRedo.ts, CommandBar.tsx:120/128) pass the store layout as currentLayout, confirming the redo-stale-currentLayout claim.
- Decision 1, 3, 4, spec scenarios, tasks cover all four ACs (keyboard, redo, CommandBar, real-browser test). No placeholders/contradictions found.

### Verdict: REFUTE

### Change Requests
1. Decision 2 (persistedLayoutRef advances only on mount / PATCH-fulfilled) is under-specified and introduces an unaddressed behaviour change. Today the resolvedLayout effect (useLayoutSave.ts:60-72) re-baselines persistedLayoutRef on EVERY resolvedLayout change, including changes NOT of drag origin: `createPanel` writes `setDashboardLayoutLocally` (panelThunks.ts:~124-138), panel deletion/panel-set changes alter `resolveDashboardLayout(panels, layout)`, and projection/default placement fills missing entries. With the new rule each of those makes store/resolved layout differ from the mount-time persisted ref, so the effect (per Decision 2) dispatches setLayoutPending(true) and the next autosave/Save-now/unmount sends a layout PATCH nobody asked for, where today none occurs. Design only mentions "server refetch or external patch" and calls it idempotent, which does not cover panel create/delete. Revise the design to state explicitly how non-interaction layout changes (panel create, delete, resolve-time projection) are handled: either (a) keep re-baselining persisted on resolvedLayout changes whose origin is not a drag/resize commit or undo/redo (e.g. a "local-origin" marker set by the stop commit and the undo/redo path), or (b) explicitly accept and justify the new PATCH-on-panel-create/delete behaviour, state its consequences for hasPendingLayout and existing tests, and add a unit test pinning whichever is chosen. Add that scenario to the spec/tasks 2.1.

### Non-blocking notes
- A PATCH fulfilled replaces the store dashboard with the server response (dashboardsSlice.ts:297-302); a drag landing while a PATCH is in flight would be overwritten by the older response. Pre-existing, but the commit-at-stop now makes the window slightly more reachable; worth a unit test or a note.
- CLAUDE.md's "250ms debounce" correction noted; fine.
