## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `60086f02bb5b1ee48f2246bc09e3e66349199585` (planning artifacts untracked in the change dir).
Scope: Phase A (D1–D7, tasks 1.x/2.x, the three spec deltas). Phase B is an outline and was not judged on completeness.

### What I verified (with evidence)

- **The 57px chain is correct.** `PanelList.css` phone `.panel-list { padding: var(--space-5) }` (20) +
  `MobilePanelStack.css` `.mobile-panel-stack { padding: var(--space-3) }` (12) + card border 1 +
  `PanelGrid.css:38` `padding: clamp(var(--space-3), 2vw, var(--space-5))` (12 at 375px, since 2vw = 7.5) +
  `MarkdownPanel.css:4` `padding: var(--space-2) var(--space-3)` (12) = 57. Token values from `theme/theme.css:48-57`.
  `.app-content` has no horizontal padding on the phone shell (`App.css:288`, `:498`).
- **Zoom widget facts are correct.** `position: fixed` (`PanelList.css`), `display: none` only at `max-width: 430px`, and
  lifted above the nav at `max-width: 768px`, so it floats over content in the 431–768px band. `useIsPhoneShell` exists
  (`app/shell/useIsPhoneShell.ts`, `(max-width: 768px)`).
- **Stack switch is container-based:** `PanelGrid.tsx` `const isPhone = width < panelGridConfig.breakpoints.sm` (sm = 768),
  where `width` is `useContainerWidth` on `.panel-list__zoom-container` (`PanelList.tsx:76-86`), i.e. `.panel-list`'s
  content box.
- **`recentHistoryStore`** exports `loadRecentHistory()`; dashboard visits are recorded on any change of
  `state.dashboards.selectedDashboardId` (`recentVisitsListeners.ts:33-48`), so recents track sheet selections too.
- **PanelList mount sites:** `AppRoutes.tsx:112` (`/home`) and `DashboardRoute.tsx:56` (`/dashboards/:id`). On main
  `/home` IS the dashboard view; HEL-1578 (`git diff 60086f02b...HEAD` in its worktree) moves it to `/dashboards` and
  makes `/home` the Home page. So D3's "only the dashboard view mounts PanelList" holds in both worlds.
- **Selection model:** `DashboardList.tsx:330` (context list and phone sheet, `ContextListBody.tsx:31`) selects with
  `dispatch(setSelectedDashboardId(id))` only and never navigates. HEL-1578's `mobile-dashboard-sheet` delta keeps that.
  `DashboardRoute.tsx:31-33` dispatches the selection only in an effect keyed on `[id, known]`.
- **Phase A vs the pending ruling.** The tab-set options (`assistant-to-header | home-absorbs-dashboards | me-stays-avatar
  | six-tabs`) and the refreshed-line options do not touch gutters, the chip row, zoom, or clearance. D6 explicitly keeps
  the header as it is and defers the refreshed line. Nothing in Phase A changes BottomNav, `navDestinations`, `sections`, or
  the hel1574 6-tab pin. **Phase A is independent of the ruling.** I found nothing that pre-empts it.
- **DESIGN.md:** §12 (12px edge, 10px only as a <=4px optical tweak), §3 spacing rule, §0 accent discipline, and §4
  breakpoints (768/430 canonical) are read and cited correctly by D1/D4.
- **AC coverage (Phase A):** AC1 is covered by D1 and task 2.1 (rendered-pixel measurement). AC2 is covered by D3–D5.
  AC4 is covered by D2 and D7. The other fixed/sticky surfaces on the dashboard view are user-opened (drawer, modal,
  sheet) or transient (toast). AC3 is Phase B and correctly blocked.

### Verdict: REFUTE

D1 as written breaks two things that already work, and D3's tap mechanism fails a reachable one-tap switch. All three
are cheap to fix in the artifacts now and costly to find in execution.

### Change Requests

1. **D1 moves the phone stack/grid boundary: at a 768px viewport the desktop grid would render on the phone shell.**
   `PanelGrid` picks the stack only when the measured container is `< 768`. Today the phone `.panel-list` padding
   (2 x 20) makes the container 728 at a 768px viewport, so the stack renders. D1 removes `.panel-list`'s horizontal
   padding, so on any device with overlay scrollbars (every phone and tablet, including iPad-mini portrait at exactly
   768) the container becomes 768. `768 < 768` is false, so `DesktopPanelGrid` (RGL) renders on the phone shell, with
   the zoom widget removed and zoom forced to 1.0 by D2. Headless Chromium's classic scrollbar (about 15px) would hide
   this in e2e at 768, which is one of C1's measured widths. Revise D1 so the phone shell and the stack switch cannot
   disagree. Either keep the edge inset on `.panel-list` (`padding-inline: var(--space-3)`) and zero the stack's inline
   padding, or make the switch agree with `useIsPhoneShell`. State which, and add a unit/e2e assertion that the stack
   (not RGL) renders at a 768px viewport with a 768px container.
2. **D1 leaves every non-stack child of `.panel-list` flush against the screen edge.** `.panel-list` also renders
   `StatusMessage`, `FirstRunDropZone`, `OnboardingChecklist`, `CrossFilterIndicator`, both `EmptyState`s, and (new) the
   chip row (`PanelList.tsx` around lines 320-470). None has a horizontal margin of its own (`StatusMessage.css:2`
   `margin: 0 0 var(--space-4)`, `CrossFilterIndicator.css:10` `margin: 0 0 var(--space-4)`,
   `OnboardingChecklist.css` and `FirstRunDropZone.css` `margin-bottom` only). If `.panel-list` loses its inline padding
   and only `.mobile-panel-stack` gets it, those bordered cards render at 0px from the edge, which breaks §12 "page
   content sits `--space-3` from the screen edge". Fix D1 so a single owner gives every `.panel-list` child the 12px
   edge. Moving the inset to `.panel-list` per CR1 fixes both at once. Extend task 2.1/2.2 to measure one non-stack child,
   for example the "No panels yet" empty state or the onboarding checklist, at 12px.
3. **D3's tap = `navigate(/dashboards/<id>)` alone fails a reachable one-tap switch and does not hold its
   "never reshuffles" guarantee.**
   (a) The phone sheet selects Redux-only (`DashboardList.tsx:330`), and `DashboardRoute` re-selects only when the URL
   `id` changes. Sequence: tap chip A (URL `/dashboards/A`), pick B from the name sheet (URL stays `/dashboards/A`,
   selection B), tap chip A. The result is `navigate("/dashboards/A")`, the same params, no effect, and B stays
   selected. The AC "chips switch dashboards in one tap" fails.
   (b) On main, the first tap from `/home` (and after HEL-1578, from `/dashboards`) changes the route element, so
   `PanelList` remounts and the "computed once per mount" order is recomputed with the tapped dashboard now first.
   The row reshuffles under the finger on exactly the first tap.
   Specify a tap that always selects, for example `dispatch(setSelectedDashboardId(id))` plus the navigate, or a
   select-only tap consistent with the sheet. Specify how order stability survives the remount, or drop the claim.
   Add an RTL test for sequence (a) to task 1.4.
4. **Pin the chip row's DOM position and reconcile it with the spec.** The spec says the row is "directly below the
   command bar". D3 says "inside `PanelList` … above the stack", and does not say whether it goes before or after
   `StatusMessage`, the first-run drop zone, the onboarding checklist and `CrossFilterIndicator`. On
   `/dashboards/:id`, `FirstRunRefineBar` renders above `PanelList` (`DashboardRoute.tsx:54-56`), so "directly below the
   command bar" is false there. State the row is `.panel-list`'s first child, outside `.panel-list__zoom-container`, and
   reword the spec to match, for example "at the top of the dashboard view, above all panel content". State the row's
   own inline inset and `scroll-padding-inline` (12px) so D5's "one gutter of breathing room" has a defined value.

### Non-blocking notes

- `mobile-dashboard-chips` spec says the active chip is filled "using the accent only as DESIGN.md §0 allows for
  selection". D4 decides inverted ink with no accent. Make the spec say what D4 decided so an executor does not read it
  as permission to fill with accent.
- D2 says the saved zoom "is not written". The ctrl-wheel/trackpad-pinch handler (`PanelList.tsx:239-270`) still writes
  `zoomLevel` if it fires at a phone-shell width, for example in a narrowed desktop window. Gate it on `!isPhoneShell`
  too, or the "not written" guarantee is only mostly true.
- D3 says "still present in `items`" and "remaining `items`". Inside `PanelList`, `items` is the panels list
  (`PanelList.tsx:41`); dashboards are `dashboards`. Say `state.dashboards.items`.
- The `mobilePanelHeights.ts` constants no longer drive chart sizing (HEL-909 retired that). They only feed
  `resolveStackContentWidth` (`MobilePanelStack.tsx:107`). The rationale in the context section is stale, but the task
  (re-derive them) is still right.
- The `dashboard-chrome-zoom-widget` delta keeps the pre-existing `position: absolute` text while the CSS is `fixed`. The
  planner flagged this as pre-existing drift, so it is acceptable to leave.
- HEL-1578 also edits `PanelList.tsx` (imports plus the `stepByStep`/`useDashboardViewStamp` block). The regions differ,
  but expect a small rebase conflict near the imports.
