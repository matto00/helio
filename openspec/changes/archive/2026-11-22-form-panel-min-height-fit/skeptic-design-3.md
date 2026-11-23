## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Scope: the owner ruling as recorded in D3, design D4, the `specs/form-panel-rendering/spec.md` delta, and task group 4.
The ruling itself is not reopened. Reviewed at HEAD `c1b60c8b3b8e32c2bd056993b19d537129a0760a`.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/form-panel-min-height-clip/HEL-1618`.
- **D3 is faithful to the ruling as briefed.** It records 5 rows at lg/md/sm/xs, the compact-counter exception at 4,
  no bump and no layout write on load, the minimum applying on the next resize or placement, and widths unchanged.
- **The live code matches the design's citations.**
  - `panelGridConfig.ts` `createLayouts` sets `minH: panelGridConfig.itemHeights.min` (4) on all four breakpoints and
    `minW: Math.min(2, item.w)` on lg/md/sm.
  - The callers are `DesktopPanelGrid.tsx:133` and `DesktopPanelGridSkeleton.tsx:50`, and there are no others.
  - The only other use of `itemHeights` is the short-card rhythm at `DesktopPanelGrid.tsx:141`.
  - `PanelPacker.scala:44` has `Form -> ClampBounds(minW = 3, minH = 5, ...)`.
  - The fallback placement in `dashboardLayout.ts:29,79,199` uses `defaultItemHeight = 5`, so new panels already get 5.
  - Compact-counter detection already exists in exactly the form D3 states:
    `FormPanelView.tsx:128`, `config.fields.length === 1 && config.fields[0].control === "counter"`.
- **The spec delta is a complete MODIFIED block.** Base `openspec/specs/form-panel-rendering/spec.md:146-158` is
  carried verbatim, both existing scenarios are kept, and the new text and scenarios are added.
- **RGL 2.2.4 mount and sync, read from `frontend/node_modules/react-grid-layout/dist`:**
  - `synchronizeLayoutWithChildren` (chunk-7ZM5LVH2.mjs:557) clones the item.
  - `correctBounds` (chunk-76RTO6EO.mjs:257) touches only x/w/y-for-statics, never h against minH.
  - So on a code reading, branch (a) is what the probe should find (no clamp on mount). The probe is still right to
    measure this rather than assume it.
- **RGL 2.2.4 resize, read from the same dist:**
  - `defaultConstraints = [gridBounds, minMaxSize]` (chunk-KDANGDDL.mjs:115).
  - `minMaxSize.constrainSize` clamps `h` to `item.minH` on EVERY resize tick (chunk-KDANGDDL.mjs:24-31, applied
    from chunk-7ZM5LVH2.mjs:356).
  - `onResize` (chunk-7ZM5LVH2.mjs:876-891), with `preventCollision` (which `DesktopPanelGrid.tsx:34` sets), reverts
    BOTH `w` and `h` to the item's original values when the constrained size collides with any item.
- **Measurements (`measurements.md` §3):**
  - A 2-field form at 4 rows hides 21 px (Comfortable) or 17 px (Compact). One extra row adds 64 px (52 + 12), so at
    5 rows the 2-field case fits. The spec's last scenario is achievable.
  - A 3-field form hides 88 px at 4 rows, so about 24 px still hides at 5 rows.

### Verdict: REFUTE

### Change Requests

1. **D4 and the spec must define what happens when a saved sub-5-row form cannot grow on its "next resize".**
   - The problem, read from RGL 2.2.4 code:
     - Take branch (a), `minH = 5`, and a saved 4-row form with another panel directly beneath it. That is the
       normal packed case, since tidy and fallback placement stack items flush.
     - On the first resize tick `minMaxSize` turns `h` into 5.
     - The collision check at chunk-7ZM5LVH2.mjs:876-891 then finds the neighbour and reverts `w` AND `h`.
     - The result: the form cannot be resized at all, not even horizontally or wider. No feedback is given. The user
       has to move the neighbour first.
   - In branch (b) the "resize-stop lift to >= 5" can create an overlap with the same neighbour (`noCompactor`, no
     re-resolve), and D4 does not say how that is resolved.
   - Either way, the ruling's "the minimum applies on the next resize" has a case where the next resize cannot apply
     it, and D4 is silent on it.
   - Required:
     - D4 states the intended behaviour for this case. Examples: accept "blocked until there is room" and say so;
       or use `minH = Math.min(5, h)` with a lift only when the cell below is free; or another choice.
     - If the choice changes what the owner ruled (for example, a width-only resize leaving the form at 4), it is
       raised to the orchestrator, not self-approved.
     - The spec gets a scenario for it.
     - Task 4.2's Playwright spec covers it: a saved 4-row form with a panel directly beneath it, resized.
   - Note that the 4.1 probe as written (mount only) cannot detect this.
2. **Label the no-bump test as a GUARD and give it a failable mutation.**
   - "A saved 4-row form renders at 4 with no layout PATCH on load" passes on today's code, where `minH` is 4. It is
     therefore not red-first.
   - D4's named mutations (min back to 4; drop the counter exception) never make it fail, so as planned it proves
     nothing (lane C12, red-vs-guard).
   - Required:
     - Label it a guard in D4 and in task 4.2.
     - Name a mutation that must turn it red, for example `createLayouts` emitting `h: Math.max(item.h, minH)` for
       forms, or a resolve-time clamp. Add that mutation to task 4.5.

### Non-blocking notes

- `DesktopPanelGridSkeleton` holds skeleton stub panels, not real panels with a `kind`. "Pass it from the panels they
  already hold" should say the skeleton passes no lookup and gets the default of 4. This is harmless because
  drag and resize are disabled there.
- At 5 rows a 3-field form still hides about 24 px (from the measured 88 px minus 64 px). That is within the AC,
  which names two fields, but say it in the D4 "After" measurement so it is not read as a regression.
- Undo/redo of a resize back to a saved 4-row form is another "placement" path. On the RGL reading above it is not
  clamped, which is consistent with the no-bump rule. Include it in the 4.4 enumeration.
