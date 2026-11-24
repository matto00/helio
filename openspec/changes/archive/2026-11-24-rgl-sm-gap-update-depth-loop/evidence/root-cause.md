# HEL-1835 root cause (probe-confirmed, main 0548a4640, lane DB helio_hel1835)

## Reproduction
- `e2e/hel1835-probe.spec.ts` (lane scratch, never committed): register user, 9 `text` panels, PATCH layout, full
  `page.goto` at 1280x1000 (container 928 -> `sm`). Console error "Maximum update depth exceeded" 3-4 times per load
  (the dev React build; stack `react-grid-layout.js` GridLayout sync effect `setLayout`).
- Matrix (errors per load, 1280 wide):
  - lg full, md `[]`, sm gap (items at x=3,w=2), xs full: **3**; md `[]` + xs `[]` + sm gap: 3-4; md `[]` + sm with NO gap: **4**
  - md full + sm gap, xs full: 0; md full + xs `[]`: 0; one panel only, md `[]`: 0
  - => the column gap is NOT the trigger (premise in the ticket refuted). The trigger is a stored `md` layout that is
    empty (derived at render), i.e. the md layout the 1280-wide first render derives differs from the `sm` one,
    with several panels.

## Which Responsive loops (C2): the SKELETON, not DesktopPanelGrid
Temporary instrumentation (a Playwright `page.route` rewrite of the served `react-grid-layout.js`, nothing in the
repo): 896 trace events on one load: `ResponsiveGridLayout` renders 446x with `onDragStart` undefined
(= `DesktopPanelGridSkeleton`), 6x with it defined (= the real `DesktopPanelGrid`). 222 inner `GridLayout`
sync-effect `setLayout`s and 221 `Responsive.handleLayoutChange` calls, all in the skeleton instance.

## Prop sequence (skeleton `Responsive`, single instance, same state throughout)
1. renders 0-1: width 1280 (`panelGridConfig.initialWidth`), breakpoint `md`/10 cols, layouts = 3 stub items (the
   dashboard list has not arrived: default stubs).
2. render 2: ONE render changes BOTH `width` 1280 -> 928 (breakpoint md -> sm) AND `layouts` (3 -> 9 stub items;
   the dashboard layout arrived). The skeleton key is `dashboardId` only, so the instance is kept.
   This is exactly the HEL-1575 library shape (layouts + breakpoint change in one render).
3. Responsive: derived-layout effect (still breakpoint md/10 cols) and width effect (-> sm/6) both `setLayout`; the
   inner `GridLayout` still holds the md/10-col layout in its own state while `propsLayout` is the sm layout A.
4. GridLayout's onLayoutChange effect publishes its CURRENT (previous-render) state: the stale md layout. 
   `Responsive.handleLayoutChange(stale)` does `setLayout(stale)` and so feeds `propsLayout := stale` (x=7 at cols 6,
   bounds-corrected by the sync to B). The sync effect then sets state B and later publishes A again, etc.: each
   publish is one step behind the props it follows, so `propsLayout` alternates A/B/A/B (trace entries 8-40 show
   `cur`/`props`/`next` alternating) and never settles until React's 50-update guard fires ("Maximum update depth").
   No helio `onLayoutChange` is involved (the skeleton passes none), no `layouts` identity churn (`pl=` constant),
   no PATCH: the only PATCH during load is `/api/users/me/preferences`.
- Hypotheses: H1 (HEL-1575 shape: width/breakpoint + layouts in one render) CONFIRMED, now for the skeleton's
  STUB layout arriving together with the measured width. H2 (feedback through helio) REJECTED (skeleton has no
  onLayoutChange). H3 (unstable identity) REJECTED (`layouts` content/identity stable across the loop).
- Library defect: yes, the same react-grid-layout 2.2.4 defect HEL-1575 met (stale GridLayout publish re-adopted by
  Responsive). A helio-side prop sequence avoids it: never change breakpoint and layouts in one render of the same
  instance. A remount (key) is what HEL-1575 used; keying the skeleton also by the ACTIVE BREAKPOINT removes the
  case where the width crosses a breakpoint while the instance lives, for any viewport.
