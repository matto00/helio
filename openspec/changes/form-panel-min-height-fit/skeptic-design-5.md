## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Scope: D3/D4, `specs/form-panel-rendering/spec.md`, task group 4. I did not reopen the owner rulings
(min-height-5-rows; lift-when-free). Reviewed at HEAD `c1b60c8b3b8e32c2bd056993b19d537129a0760a`. The artifacts under
review are uncommitted files in the change dir.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.
- **Round-4 CR1 (where the lift happens) is addressed.** D4 puts the lift on `next` before `markLayoutChanged` and
  `commitInteractionLayout`, which makes it one store write that equals `localCommitRef`. The id comes from
  `onResizeStop`'s `newItem.i`. The proof plan asserts the persisted h (from the Save-now PATCH body or a reload) for
  both the lift case and the blocked case, and it names the "separate store write" mutation.
  - I checked the trap D4 guards against, in `useLayoutSave.ts:181-230`. A store write that is not equal to
    `localCommitRef` falls into the else-branch, which re-baselines `persistedLayoutRef` and clears pending. So
    the separate-write mutation really does drop the save, while the rendered h=5 stays green. The mutation is
    meaningful.
- **Round-4 CR2 is addressed.** A sub-5 form gets `itemHeights.min` (4), which is today's exact minimum. A unit
  case for stored h=3 → minH 4 is named.
- **RGL 2.2.4 claims hold** (version string checked in `frontend/node_modules/react-grid-layout/package.json`):
  - `minMaxSize.constrainSize` clamps h to minH on every resize tick (`chunk-KDANGDDL.mjs:24-31`).
  - `preventCollision` is taken from the compactor (`chunk-7ZM5LVH2.mjs:670`). `DesktopPanelGrid.tsx:34/202` passes
    `noCompactorPreventCollision`. On a collision, `onResize` reverts both w and h (`:876-891`).
  - `onResizeStop` passes `l` (the new item) to `onResizeStopProp`. It calls `onLayoutChange` only when
    `!deepEqual(oldLayout, finalLayout)` (`:932-956`). That supports D4's statement that "a resize that ends where it
    started fires nothing".
- **The commit path matches D4's model, with two inaccuracies.** The path is `useGridLayoutInteraction.ts:82-120`:
  `handleResizeStop` only pushes the undo snapshot and arms the flag, and `handleLayoutChange` commits.
  - First inaccuracy: the handler lives in `useGridLayoutInteraction.ts`, not `DesktopPanelGrid.tsx`.
  - Second inaccuracy: `markLayoutChanged(next)` (line 112) runs before the `if (commitOnNextLayoutChangeRef.current)`
    branch (line 113), not inside it. See fold-in 3.
- **The other citations are accurate:**
  - `createLayouts` gives `minH: itemHeights.min` at all four breakpoints (`panelGridConfig.ts:80-121`).
  - `createLayouts` is called only from `DesktopPanelGrid.tsx:133` and `DesktopPanelGridSkeleton.tsx:50`.
  - The short-card filter is at `DesktopPanelGrid.tsx:141`.
  - The compact-counter predicate is at `FormPanelView.tsx:128`.
- **Placement:** the backend `PlacementSizes.ContentDefault` gives h=5 (`CreatePlacement.scala:21-31`). So the
  ordinary create path already places forms at 5. Task 4.4's enumeration remains the check for the other paths.
- **The spec delta matches both rulings:** 5 rows at every desktop breakpoint, the counter stays at 4, no bump or save
  on load, lift-when-free with no other panel moving, and a scenario for each branch.

### Verdict: CONFIRM

The design implements both rulings correctly against the live code, and the proof plan would detect each failure mode
that matters. Below are four defects in how the proof and the implementation are specified. Each one has an exact
fix. None needs a redesign, so they go to the executor as **required fold-ins** and not as another design round. The
orchestrator should pass them in the executor brief, and the evaluator should check each one.

### Required executor fold-ins (binding, check at evaluation)

1. **The named GUARD mutation does nothing under D4's own rule. Replace it.**
   - D4 and task 4.5 name the mutation `createLayouts` emitting `h: Math.max(item.h, minH)` for forms. Under D4, a
     stored 4-row form gets `minH = 4`, so `Math.max(4, 4) = 4`. The mutation changes nothing, and the no-bump guard
     stays green. That is evidence-shaped non-evidence.
   - Use `h: Math.max(item.h, FORM_MIN_ROWS)` for non-counter forms instead, which is a real on-load bump.
   - Record that this mutation turns the guard red (rendered h becomes 5). Also confirm whether the pending flag is
     set; record the result either way.
2. **Bound the lifetime of the resized-id ref.** D4 holds `newItem.i` in a ref "for the committing onLayoutChange",
   but never says when that ref is cleared.
   - When a resize ends where it started, RGL fires no `onLayoutChange` (`chunk-7ZM5LVH2.mjs:953`), so the ref keeps
     the id.
   - The commit flag clears itself on a zero-delay timer (`useCommitFlag.ts:26`). The ref does not.
   - A later drag commit (`handleDragStop` arms the flag) would then read the stale id. It would lift that form on a
     move, possibly while a different panel is the one being dragged. That breaks "at resize end".
   - Fix: consume and clear the ref in the committed branch, and also clear it wherever the commit flag is cleared,
     at drag start and at resize start.
   - Add a jest case: a resize that ends where it started, then a drag of another panel, and the sub-5 form is not
     lifted. Removing the clear must turn that case red.
3. **Fix the placement wording in the code.** `markLayoutChanged(next)` runs outside the committed branch, at
   `useGridLayoutInteraction.ts:112`.
   - Compute the lifted `next` before line 112. Gate it on `commitOnNextLayoutChangeRef.current` and on a resized id
     being held, so that `markLayoutChanged`, `commitInteractionLayout` and the store write all receive the same lifted
     object.
   - Never let a non-committing `onLayoutChange` (one of the drag/resize ticks, or an echo) lift.
4. **Run `isSpaceBelowFree` over the full stored breakpoint.** It must check `next[bp]` including the `kept` items of
   panels this tab has not loaded (`useGridLayoutInteraction.ts:107-111`), not only RGL's loaded items. Otherwise
   the lift can overlap another writer's panel.
   - Add one unit or hook case where a kept (unloaded) item sits directly below the form, and the form stays at 4.

### Non-blocking notes

- **The RGL echo after a lifted commit.** After the commit, the inner GridLayout's sync effect
  (`chunk-7ZM5LVH2.mjs:738-744`) re-emits RGL's not-yet-synced `finalLayout`, which is unlifted (h=4).
  - Today that echo equals the store and is a no-op. With the lift it differs from `resolvedLayout`, so
    `markLayoutChanged(unlifted)` runs once.
  - By my reading it converges: `useLayoutSave`'s parent effect resets `latestLayoutRef` to the store layout after the
    child effects run, and a later echo carries the lifted layout. I did not run this, though.
  - The planned persisted-h Playwright assertion (the Save-now PATCH body) is the check that settles it. Also assert
    that the card is still 5 rows after the layout settles (no flash back to 4), and that a second Save now sends
    nothing.
- **Use one compact-counter predicate.** Share it between `FormPanelView.tsx:128` and the new grid helper (for
  example, export it from `ui/form/`) rather than writing it twice. Decide what a form with zero fields or a missing
  config returns: 5 matches `PanelPacker`.
- **Spec wording.** "SHALL NOT be ... resized to fewer than 5 rows" is qualified by the sub-5 sentences that follow
  it. A reader can reconcile the two, and the scenarios are unambiguous.
- **The 3-field form.** It still scrolls about 24 px at 5 rows. The AC covers two fields, and the plan already says to
  state this in the table.

### Gate defect note

None. No mtime-ordering evidence is relied on in this review.
