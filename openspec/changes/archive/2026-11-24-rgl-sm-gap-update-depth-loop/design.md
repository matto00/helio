## Context

See proposal.md - Why. The desktop grid is `DesktopPanelGrid.tsx`, which renders RGL 2.2.4's `Responsive`
(`node_modules/react-grid-layout/dist/chunk-7ZM5LVH2.mjs:1307`, `ResponsiveGridLayout`) with:
`layouts = useMemo(createLayouts(resolveDashboardLayout(panels, layout), panelMinRows))` (deps `[resolvedLayout,
panels]`), `width` measured by `PanelGrid`, `onWidthChange = useProcessedWidth(width).handleWidthChange`,
`onLayoutChange = useGridLayoutInteraction(...).handleLayoutChange`, `compactor = noCompactor + preventCollision`.
`ResponsiveGridLayout` holds its own `breakpoint/cols/layout/layouts` state. Two effects can `setState` on any render:
the derived-layout effect (when `propsLayouts` is not `deepEqual` to its last adopted value) and the width/breakpoint
effect (when `width`, `breakpoints` or `cols` changed), which also calls `onLayoutChange` and `onWidthChange`.
HEL-1618's skeptic recorded the stack as "RGL's sync effect ... calling setState", 8-9 errors, only on an `sm`
layout with a column gap (items at x=3, w=2 after narrowing), 0 errors on the un-narrowed layout. The probe
(`.concertino/runs/HEL-1618/evidence/scratch/skeptic-final/probe-depth.cjs`) hardcodes port 7050 and a 1280x1000
viewport. HEL-1575's loop: skeleton `Responsive` re-rendered with new `layouts` and new breakpoint in ONE render;
fixed by keying the skeleton by dashboard id (`hel1575-delayed-restore-no-update-loop.spec.ts`).

## Goals / Non-Goals

**Goals:** the root cause named by probe evidence (which component, which prop, which effect); a fix at that cause;
a red-first e2e test for the reproducing layout plus a mutation (revert the fix → red).
**Non-Goals:** library patches/forks/upgrades; any geometry rule change; console filtering; width special cases.

## Decisions

### D1. Root cause first, by instrumented probe (systematic-debugging law)
Before any fix, the executor reproduces the loop on main (0548a4640) in its own lane (lane ports, lane DB
`helio_hel1835`), building the reproducing dashboard via the API: text panels only, a valid `sm` layout leaving a
column gap, loaded with a full page load at a viewport that selects `sm`. It records (a) the error count, (b) the
React component stack (`console.error` args include the component stack in dev builds) and (c) a per-render trace of
the props `DesktopPanelGrid` passes to `Responsive` (`width`, `layouts` identity + `deepEqual` vs previous, active
breakpoint, `onLayoutChange` calls with their layouts, `onWidthChange` calls). Instrumentation is temporary and never
committed. Evidence goes to `.concertino/runs/HEL-1835/evidence/`. The probe must also find the minimal layout that
reproduces (is it the column gap, the narrowing, or the sm↔other-breakpoint transition on first measure?).

Hypotheses the trace must confirm or reject (one is expected, none is presumed):
- **H1 (HEL-1575 shape):** on first measure `width` changes from the pre-measure value AND `layouts` identity changes
  in the same render, so the width effect and the derived-layout effect fight.
- **H2 (feedback through helio):** RGL's width/breakpoint effect calls `onLayoutChange` with a layout that differs
  from helio's resolved one (e.g. `findOrGenerateResponsiveLayout`/`synchronizeLayoutWithChildren` moves an item into
  the gap); `handleLayoutChange` feeds it back (store/ref/state), producing a new `layouts` prop, and the two disagree
  each round.
- **H3 (unstable identity):** `layouts` (or another object prop such as `dragConfig`/`resizeConfig`/`cols`) changes
  identity every render with content RGL's `deepEqual` treats as different, re-triggering an effect.

### D2. Fix at the confirmed cause, in helio
- H1 → make the first committed render of `Responsive` already carry the measured width (or key `Responsive` so a
  breakpoint change from the measured width remounts rather than updates, as HEL-1575 did), whichever the trace
  shows removes the double change; keying must not remount on every width change (only on the first measure /
  dashboard id) because a remount on resize would drop staged drag state.
- H2 → make helio's resolved layout and what RGL adopts agree (e.g. ignore an `onLayoutChange` that is not a user
  interaction and is not different from the resolved layout under the same rules, or pass `layouts` RGL will not
  rewrite); the HEL-1618/`breakpoint-layout-resolution` "persist only on an edit at that breakpoint" rule must hold.
- H3 → stabilise the identity (content-keyed memo) of the offending prop.
- A cause inside RGL that no helio-side prop sequence avoids → ESCALATION with the minimal repro; nothing is filed
  upstream without the owner.

### D3. Tests
- **e2e** (new `e2e/hel1835-*.spec.ts`): builds the minimal reproducing dashboard via the API, full page load at the
  `sm` viewport, asserts zero console errors containing "Maximum update depth", zero `PATCH /api/dashboards/` requests
  during the load window, and each panel's rendered grid position equals its stored `sm` position; also loads at `md`
  and `lg` widths. Red on main first (committed as `.txt` before the fix), green after; mutation: revert the fix → red.
- **jest** where the cause can be shown in jsdom (e.g. a render-count/`onLayoutChange` call-count guard on
  `DesktopPanelGrid` with the reproducing layout); if jsdom cannot reproduce it, say so with the evidence.
- Regression: HEL-1575 specs (`e2e/hel1575-*.spec.ts`) and `e2e/hel1624-direct-load-selection.spec.ts` stay green;
  the full grid jest folder stays green.

### D4. No visual change
Before/after screenshots at the `sm` viewport, both themes, of the reproducing dashboard; panels at identical
positions and sizes.

## Risks / Trade-offs

- [The loop depends on timing, so a single green run proves little] → run the new e2e at least 3 times on main (red
  each time) and 3 times after the fix (green each time); record counts.
- [Keying `Responsive` can remount the grid and lose staged layout] → keyed only by values that change at mount/dash
  switch; the `useLayoutSave` unmount flush and `DesktopPanelGrid.layoutCommit`/`unmountFlush` tests must stay green.
- [Suppressing `onLayoutChange` could drop a real edit] → any filter keys on "not a user interaction" via the existing
  commit flag (`useCommitFlag`), and the edit-mode/layoutCommit tests stay green.

## Planner Notes

- Self-approved: no spec geometry change; one ADDED requirement in `breakpoint-layout-resolution`.
- Sibling lanes: HEL-1834 (backend placement) and HEL-1830 (e2e hel1791/hel1582). If `panelGridConfig.ts` is touched,
  diff it against HEL-1834's branch first.
- Lane DB `helio_hel1835`; servers only via `start-servers.sh` with `DATABASE_URL` exported in the same command.
