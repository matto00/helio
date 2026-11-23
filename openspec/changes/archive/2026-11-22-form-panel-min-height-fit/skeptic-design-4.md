## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Scope: D3/D4, `specs/form-panel-rendering/spec.md`, task group 4. The owner rulings (min-height-5-rows; lift-when-free)
are not reopened. Reviewed at HEAD `c1b60c8b3b8e32c2bd056993b19d537129a0760a` (artifacts under review are uncommitted
files in the change dir).

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.
- Round-3 change requests are addressed in the text. CR1: D4 defines the sub-5 case (lift-when-free, the owner's
  ruling), the spec has "grows on its next resize" and "panel directly below stays at 4" scenarios, and the Playwright
  plan covers both. CR2: the no-bump test is labelled a GUARD in D4 and task 4.2, and the `Math.max(item.h, minH)`
  mutation is named in D4 and task 4.5. The skeleton and 3-field notes are folded in, and undo/redo is in 4.4.
- D3 matches the ruling as briefed: 5 rows at lg/md/sm/xs, compact counter stays at 4, no bump or save on load.
- Live code matches the citations:
  - `panelGridConfig.ts` `createLayouts` uses `minH: panelGridConfig.itemHeights.min` (4) on all four breakpoints.
  - `DesktopPanelGrid.tsx:133` and `:141` are as cited.
  - The compact-counter rule is at `FormPanelView.tsx:128`.
- RGL 2.2.4 (`frontend/node_modules/react-grid-layout/dist`, version string checked):
  - `minMaxSize.constrainSize` (chunk-KDANGDDL.mjs:24-31) clamps `h` to `minH` on every resize tick.
  - `onResize` (chunk-7ZM5LVH2.mjs:876-891) with `preventCollision` reverts w AND h on collision. So `minH = 4` for a
    stored 4-row form really does keep today's resize behaviour.
  - `onResizeStop` (chunk-7ZM5LVH2.mjs:932-956) calls `onResizeStopProp` and then `onLayoutChange(finalLayout)` directly.
  - `ResponsiveGridLayout`'s `derivedLayout` (1356-1379) re-syncs from a deep-changed `layouts` prop. A lifted store
    layout therefore does reach RGL's internal state. The lift is mechanically feasible.
- Commit path (`useGridLayoutInteraction.ts:82-120`):
  - `handleResizeStop` only pushes the undo snapshot and arms the commit flag.
  - The layout is committed in `handleLayoutChange` through `markLayoutChanged(next)` and then
    `setDashboardLayoutLocally(commitInteractionLayout(next))`.
- `useLayoutSave.ts:181-230` (the HEL-1230 classification contract):
  - A store layout write counts as an "interaction commit" only if it equals `localCommitRef` (whatever was passed to
    `commitInteractionLayout`).
  - Any other write is class 4, "server/external truth". Class 4 re-baselines `persistedLayoutRef` to that layout and
    clears pending. So a layout that never reached the server is treated as saved.
- `LayoutValidator.scala:8,31` accepts any `h >= 1`. A stored form layout with h = 1..3 is therefore reachable
  (import, assistant/proposal apply, a direct PATCH).

### Verdict: REFUTE

### Change Requests

1. **D4 must say where the lift is applied: inside the single interaction commit. The tests must prove the lifted
   height is persisted, not only rendered.**
   - D4 says only "at resize stop ... its h is lifted to 5". The live code has a silent trap here:
     - `handleResizeStop` cannot change RGL's layout.
     - Suppose the lift is written to the store as a second write: a separate `setDashboardLayoutLocally` after the
       commit, or one computed from `onResizeStop`'s arguments outside the committed `next`.
     - That write no longer equals `localCommitRef`, so `useLayoutSave` classifies it as class 4.
     - Class 4 re-baselines `persistedLayoutRef` to the lifted layout and clears pending.
     - Result: the lift, and the user's resize with it, is never saved. The page still renders at 5 rows.
   - Required in D4:
     - Apply the lift to `next` in `handleLayoutChange`'s committed branch, or equivalently, BEFORE both
       `markLayoutChanged` and `commitInteractionLayout`. One store write equals one interaction commit.
     - The helper takes the resized item's id from `onResizeStop`'s `newItem`/`oldItem`, or another stated source.
       It is not inferred.
   - Required in the proof plan (task 4.2/4.5):
     - The lift Playwright test asserts the persisted layout: the Save-now PATCH body, or a reload, shows h = 5.
     - The blocked-neighbour test asserts the persisted layout has the form at h = 4 with the new w, and the neighbour
       unchanged.
     - Add the mutation "lift dispatched as a separate store write after the commit" (or "lift applied after
       `markLayoutChanged`"). It must turn the persisted-height assertion red while the rendered-height assertion
       stays green.
2. **`minH = Math.min(5, item.h)` loosens the minimum below today's 4 for a stored form under 4 rows. That
   contradicts "a saved sub-5-row form resizes as today".**
   - Today every item gets `minH = 4`. A stored h = 2 form today is clamped to 4 on its first resize tick
     (`minMaxSize`).
   - Under D4 it gets `minH = 2`, so it can be resized to 2 or 3. That is a new behaviour, for forms only. The
     `minW: Math.min(2, item.w)` precedent cited in D4 is a different, pre-existing width rule, not the owner's
     height ruling.
   - Required:
     - A stored sub-5 form gets `panelGridConfig.itemHeights.min`, i.e. `h >= 5 ? FORM_MIN_ROWS :
       itemHeights.min`. If the plan keeps `Math.min(5, h)`, raise it with the orchestrator as a deviation from the
       ruling instead of self-approving it.
     - Add a `createLayouts` unit case: a stored h = 3 form gets `minH = 4`.

### Non-blocking notes

- "No layout PATCH on load" is weak evidence by itself, because persistence is deferred (a 30 s tick, Save now, or
  the unmount flush), so no PATCH fires in a short window anyway. Assert the rendered h = 4 and that the layout is not
  pending (the Save-now affordance is not offered, or `setLayoutPending(true)` is not dispatched). The named
  `Math.max` mutation does flip the rendered height, so the guard can still fail; this only strengthens it.
- Write the free-cell check as a small pure helper with its own unit tests: free, blocked by an overlap of one
  column, blocked at the y+4 row, and the bottom edge. The Playwright tests then stay end-to-end, and a mutation of
  the cell range is caught cheaply.
- A resize that ends exactly where it started changes nothing, so RGL fires no `onLayoutChange` and nothing lifts.
  That seems acceptable, but say it in D4 so nobody reads it as a gap against the spec's "when the resize ends below 5
  rows" sentence.
- After the 5-row rule lands, task 4.1's probe for a stored 4-row form (`minH = 4`) measures the same configuration
  as today. It duplicates the guard rather than probing anything new. It is harmless.
