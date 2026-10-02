## Context

See proposal.md. Reproduced on main (real browser, seeded via API, widths swept; scratch evidence in the HEL-1023
run's evidence dir). Findings that drive the design:

- Container width, not window width, picks the breakpoint: with the sidebar open container = window - 288 (window - 40
  under 1056). So md is window 1388..1727, sm 1056..1387, stack below ~1056.
- `resolveDashboardLayout` (`dashboards/state/dashboardLayout.ts`) returns a breakpoint's saved items unchanged when
  `saved.length >= panels.length` (id coverage is not checked: stale ids defeat it) and `cleanupOverlaps` compares only
  rectangles, never `x + w <= cols`. 12-column coordinates stored under md/sm/xs are clamped by RGL at render and overlap.
- `cleanupOverlaps` bumps the later item below the first collider, cascading (img1 y 72 -> 1962) and leaving gaps.
  `projectLayout` rounds x and w independently so neighbours collide (even a clean lg-only dashboard at sm).
- RGL 2.2.4 `getBreakpointFromWidth` uses strict `>`, so container 1440/1100/768 resolves one breakpoint low while
  `panelGridConfig` and `PanelGrid`'s `isPhone` (`< 768`) use `>=`. Container 768 mounts RGL at 2 cols.
- `fromResponsiveLayouts` + `useLayoutSave` persist ALL four resolved (derived) breakpoints on any edit, which is how
  bad per-breakpoint data is manufactured.
- Phone stack (`MobilePanelStack`): never persists; orders by `orderPanelsForMobileStack(resolved.xs)` (y, then x);
  `mobilePanelHeights.computeMobilePanelHeight` returns intrinsic height for every kind (`h` unused). It never reads a
  saved xs layout except via the resolver, so the resolver's xs derivation is what defines stack order.
- HEL-1028: `useLayoutSave` baselines persisted layout on `resolvedLayout`; drag/resize stop commits to the store via
  `setDashboardLayoutLocally`; undo snapshots are `latestLayoutRef.current`; persistence is the 30s autosave / Save now /
  unmount flush. RGL `Responsive` re-syncs only when the `layouts` prop identity changes.

## Goals / Non-Goals

**Goals:** owner ruling in proposal (derive/repair at render; persist only on edit at that breakpoint; valid authored
layouts byte-identical); every reachable breakpoint (lg/md/sm + stack) defined and tested incl. no-layout; no HEL-1028
regression.
**Non-Goals:** backend validation (HEL-1071), always-on compaction, mobile height retune, migrating stored data.

## Decisions

1. **New pure module** `dashboards/state/breakpointLayout.ts` (no React/Redux) exporting:
   `findOverlaps(items)`, `isLayoutValid(items, cols)` (every item `x>=0, w>=1, h>=1, x+w<=cols`, no overlap),
   `compactLayout(items, cols)` (clamp to bounds, sort by (y, x, input index), place each at its x with the smallest
   y that collides with nothing already placed), `deriveLayout`-equivalent (cycle 2: the standalone `deriveLayout` was removed as unused; the resolver calls `scaleLayoutItem` then
   `compactLayout`) and `nearestAuthoredBreakpoint(...)`. The overlap predicate is deliberately a small standalone
   `(a, b) => boolean` plus `findOverlaps` so HEL-1071's backend/MCP validator can mirror it. `dashboardLayout.ts` keeps
   exporting the existing public API (`resolveDashboardLayout`, `scaleLayoutItem`, `createFallbackDashboardLayout`,
   `areDashboardLayoutsEqual`); `cleanupOverlaps`/`projectLayout`/`pickProjectionSource` are removed; the three skeleton consumers
   (`DesktopPanelGridSkeleton`, `MobilePanelStackSkeleton`, `panelGridSkeletonStubs.ts`) also call it and are re-verified (tasks 2.4).
   Alternative rejected: always-on RGL `verticalCompactor` (owner-rejected: destroys authored gaps).
2. **Per-breakpoint resolution** (inside `resolveDashboardLayout`, for each bp, input = saved entries restricted to
   live panel ids, de-duplicated). Ordered, with fixed precedence:
   a. any saved entry violates bounds (`x+w>cols`, evidence the data was authored at another column count) -> the bp is
      unauthored: no anchors; every panel is derived from the nearest source (step d).
   b. otherwise saved entries are anchors; if the anchors overlap each other they are `compactLayout`ed in place
      (keeps the user's arrangement and order; the "repaired form" is what renders and what counts as a source).
   c. if every live panel has an anchor, the anchors are the result: when they were already overlap-free they are
      returned unchanged, in panel order (value-identical: byte-identical, gaps kept).
   d. each panel without an anchor is scaled from the nearest source (else default size via `createBaseLayout` logic)
      and dropped into the first free slot at or below its scaled y, in source reading order, never moving an anchor.
      So overlapping+partial = b then d; bounds-violating = d for all.
   "Nearest source": breakpoints ordered lg, md, sm, xs; candidates are other breakpoints that are non-empty and
   in-bounds for their own cols after step b's repair (so a dashboard whose only authored bp overlaps still derives the
   other breakpoints from its repaired form and keeps reading order; a bounds-violating bp is never a source); pick min
   |index distance|, tie -> wider. A bp that is only partial still serves as source for the panels it holds; panels
   missing from the nearest source are taken from the next nearest. Resolution is a pure function of `(panels, layout)`;
   `DesktopPanelGrid`/`MobilePanelStack` already `useMemo` it, so the object RGL receives only changes when store
   layout or panels change (no churn, no loop). `panelThunks.createPanel` appends one scaled item per breakpoint to
   possibly-empty arrays, producing valid-but-partial layouts: step c/d handles it (anchor + derived rest) and has its own test.
3. **Authored layout stays the store-shaped truth; resolved layout is view-only.** `useLayoutSave` takes the store
   `layout` (not the resolved one) as its baseline: `persistedLayoutRef`, `latestLayoutRef`, undo snapshots and the
   interaction-commit equality all become store-shaped. `handleLayoutChange` receives RGL's active-breakpoint layout
   (`currentLayout`) and the active bp (computed with the same shifted breakpoints, or `onBreakpointChange`); it treats
   the call as an edit when `currentLayout` differs from `resolved[activeBp]` (RGL also calls it on mount and on
   breakpoint change with exactly what we fed it): candidate = `{...layout, [activeBp]: items}`; when it does NOT differ,
   candidate = the store `layout` itself. `markLayoutChanged(candidate)` is ALWAYS called (as today), so dragging a panel
   away and back to its original cell resets `latestLayoutRef` to the store layout and `persistLayout`'s equality guard
   sends no PATCH for a reverted move (otherwise the intermediate layout would stay latest and persist). So a view never
   calls `markLayoutChanged`, never dispatches `setLayoutPending`, never `pushLayoutSnapshot`, never PATCHes; an edit at
   md persists md only. `fromResponsiveLayouts` is reduced to a single-breakpoint reader. The HEL-1028 flag/commit
   machinery, `revision` counter and undo/redo traversal are kept as is, only their layout operand changes.
4. **RGL breakpoints shifted by 0.001** (`rglBreakpoints` in `panelGridConfig.ts`, derived from
   `panelGridConfig.breakpoints`) so strict `>` equals `>=`; unit test pins it through RGL's own
   `getBreakpointFromWidth` at 1440/1439.9/1100/768. `PanelGrid`'s `isPhone` is unchanged.
5. **Phone stack**: no code change besides consuming the resolver; its order is the derived xs layout's (y, x), and
   derivation preserves the source reading order, fixing the bumped-panel reordering. `mobilePanelHeights.ts` untouched.
6. **Verification shape**: unit tests for the module (table of the repro seeds; mutation-failable: a test that an
   authored layout with gaps is returned `toBe`-equal/value-equal and fails if `compactLayout` is applied), resolver
   tests, hook/grid tests asserting no dispatch on view and md-only persistence, and a Playwright spec seeded through
   the API with markdown/image/chart/text/divider panels at window widths 1900/1500/1200/1056/400.

## Risks / Trade-offs

- [In-place compaction (2b) loses authored gaps for an overlapping layout] -> accepted by ruling ("same repair").
- [Store-shaped baseline touches HEL-1028-sensitive code] -> keep its e2e spec green; add a test that a view does not
  arm pending/history; do not change the commit-flag logic.
- [A user edit at lg leaves md empty so it stays derived; later lg edits re-derive md] -> intended; md persists only
  after an md edit.
- [Epsilon breakpoints with fractional container widths] -> <0.001px window is irrelevant; documented in the test.
- [2a treats any x+w>cols as unauthored] -> heuristic; fully-valid-looking wrong-column data cannot be detected and is
  rendered as authored (valid), which is the ruling.

## Planner Notes

Self-approved: 2a-2d ordering, 0.001 epsilon, single `compactLayout` for derive and repair, remove
`cleanupOverlaps`. Mobile stack finding stated in Context; no escalation needed because the ruling settles it.

## Cycle 2 note
Derived layouts start at y=0 (the source's top offset is dropped): "compacted" per the owner ruling.
