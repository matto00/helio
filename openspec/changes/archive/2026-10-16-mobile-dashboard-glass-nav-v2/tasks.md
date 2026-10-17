## Standing Constraints

- [C1] Every layout/contrast claim is measured from rendered pixels on this worktree's own dev server (port 7015,
  backend 9922), after `document.fonts.ready`, at 320/375/390/430/768 in both themes; screenshots saved under the
  change dir's `evidence/`.
- [C2] Resource caps: jest at most 3 workers, Playwright at most 2 workers, everything under `nice -n 19`; Bash
  `timeout: 600000`. Never pkill/pgrep/killall; stop servers only via `scripts/concertino/stop-servers.sh`.
- [C3] Guard pins (CSS-count, tab-count, 44px floors) are recounted or extended for real changes, never loosened.
  Never edit rendered Concertino files (`scripts/concertino/`, `.concertino/laws/`, `.claude/agents|commands/concertino-*`).
- [C4] (retired 2026-10-16: the owner answered `assistant-to-header`, `wire-after-1576`.)

## 1. Frontend — Phase A

- [x] 1.1 Phone stack gutters per design D1 (`PanelList.css`, `MobilePanelStack.css`, `PanelGrid.css`,
  `MarkdownPanel.css` / other plain-text bodies); verify the CSS tests in those files are updated and pass
- [x] 1.2 Re-derive `mobilePanelHeights.ts` stack chrome constants from D1; verify `mobilePanelHeights.test.ts` passes
- [x] 1.3 Zoom widget not rendered, effective zoom 1.0 and the ctrl-wheel handler inert on the phone shell (D2);
  verify PanelList unit tests
- [x] 1.4 `DashboardChipRow` (D3–D5) mounted in `PanelList` on the phone shell; verify RTL tests for order, cap, stable
  session order across remount, tap = select + navigate, the chip A -> sheet B -> chip A sequence, `aria-current`, row `scrollLeft` set for an off-screen active chip
- [x] 1.5 Chip CSS: pill, inverted active fill, 44px hit area via the `tapTarget.css` pattern; verify a CSS test

## 2. Tests — Phase A

- [x] 2.1 New e2e `e2e/hel1583-mobile-dashboard.spec.ts`: markdown text <=28px from each edge at 375px; card 12px from
  edges; a non-panel `.panel-list` child 12px from the edge; stack (not grid) at 768px; panel gap 8–12px; chip tap switches in one tap; active chip within row bounds on load; chips' hit areas
  >=44px and non-overlapping; no zoom widget at 375/600/768; last card above the nav top; passes in both themes
- [x] 2.2 Rendered-pixel measurements + screenshots at 320/375/390/430/768, light and dark, written to
  `measurements.md` and `evidence/` in this change dir
- [x] 2.3 Existing e2e specs touching the phone stack / zoom / nav still pass (run the full suite at final head) -- Phase A: 141 phone/stack/zoom/nav-relevant e2e tests pass (hel813/1023/1028/1065/1277/1305-1311/1351/1392/1398/1444/1508/1512/1574/1605/773/909/912); the full suite is left to the evaluator/final head

## 3. Integration and Phase B (owner answers: `assistant-to-header`, `wire-after-1576`)

- [x] 3.0 Merge origin/main into the branch (HEL-1576, 1572, 1575, 1578 must be in; 1573 if merged). Resolve conflicts
  by taking main's routes/predicates and keeping Phase A behaviour. The chips navigate to `/dashboards/<id>`, and the
  chip row shows only on the dashboard view (`isDashboardViewPath`), never on the Home page `/home`. Keep HEL-1575's
  skeleton-grid dashboard-id key. Re-run the Phase A unit tests and the hel1583 e2e after the merge
- [x] 3.1 D8 phone tab set via `phoneNavTabs` plus `activePrefixes` on HEL-1578's `isDestinationActive`. Add the
  `DataSectionTabs` sub-row on `/sources` and `/connectors` (phone only). Add the Me tab reusing `UserMenu` via a
  trigger variant. Remove the phone CommandBar avatar. Unit tests: tab order and names; exactly one current tab per
  route (table over `/home`, `/dashboards`, `/dashboards/x`, `/sources`, `/sources/x`, `/connectors`, `/pipelines/x`,
  `/settings`, `/admin/usage`, and `/chat` = none); owner vs non-owner Me menu (Usage only for owners); desktop rail
  unchanged; Me is a menu button with `aria-current="true"` when active. Move phone-width e2e specs that click the
  header "User menu" to the Me tab
- [x] 3.2 D9 expanding labelled active tab: every tab `flex: 0 1 auto` + 44px min, `space-evenly`; the label's
  `max-width`/`opacity` and the lozenge's inline padding (per D9) are the only transitioned properties (`min-width: 0`, ellipsis); inactive lozenge `--space-2`
  inline padding; label `--text-xs`/`--weight-semibold`/`--app-text`. CSS pins for the gating (including the label
  transition under both reduced-motion selectors), the 44px floor, the label colour, and the replacement geometry
  invariant
- [x] 3.2a D10 active pill per the owner's `opaque-pill-text-ring` answer: opaque `--app-surface-strong` fill and 1px
  `--app-text` ring on the active lozenge only. The capsule's glass is unchanged. Pins replaced, not loosened. Measure the
  edge (>=3:1) and the label (>=4.5:1) from rendered pixels over every spec backdrop in both themes. Report any shortfall
  with the numbers instead of adjusting
- [x] 3.2b Accent-text contract per the owner's `keep-022-superset`: 0.22 stays in `ACCENT_TEXT_INLINE_TINT_STRENGTHS`.
  Rewrite `accentTextSourceSyncGuard.css.test.ts` to assert that every CSS inline tint is scored, with 0.22 named as
  retained. Prove the rewritten guard red by mutation (add an unscored tint to a CSS file, and it must fail). Assert
  `--app-accent-text` is unchanged (`#fa8737` fallback pin intact). Update DESIGN.md lines 937 and 1553
- [x] 3.3 D10: re-measure the glyph and lozenge (>=3:1) and the label (>=4.5:1) from rendered pixels at 320/375/768,
  both themes, over the worst-case backgrounds. Write the results to `measurements.md` with screenshots in `evidence/`.
  Update the BottomNav unit/CSS pins, `hel1574-shell-rail` and any phone tab-count e2e, plus DESIGN.md §12 and §3
- [x] 3.4 D11 refreshed line as the first child of `.panel-list` above the chip row (phone only). Extract the
  refresh-fact text+dot helper from `DashboardMetaFacts.tsx`. Add RTL tests for ran/never/unknown/failed and absence
  on the public route. Verify `--app-command-bar-height` is unchanged
- [x] 3.5 e2e `hel1583` extended: 5 tabs; the active label visible; exactly one current tab on Home, Dashboards,
  Data (via `/connectors`) and Me (via `/settings`); Connectors reachable via Data; Usage reachable via Me for an
  owner; tap targets >=44 and non-overlapping at 320/375/768; at 320 with Dashboards and then Pipelines active, no tab or
  label box crosses the capsule's content box, the active lozenge box stays inside its own tab's box, and the label's
  `scrollWidth > clientWidth` (truncation really happens); icon box and vertical position unchanged on activation; lozenge edge
  >=3:1; active pill content-sized (not filling the bar) at
  430/768; refreshed line present above the chips on a dashboard with a run pipeline; a free-tier user reaches the
  assistant overlay in one tap and a beta user reaches `/chat` in two. Both themes
- [x] 3.5a Home at 375px (HEL-1578 risk handed to this ticket): screenshot and measure where the run timeline starts
  below Home's four shelf cards, both themes. Do NOT change Home's layout unless the change falls out of this ticket's
  own phone-gutter rules; otherwise record the numbers for a follow-up ticket
- [x] 3.6 Full e2e suite at the final head (task 2.3), under the e2e flock, 2 workers -- 436 passed, 2 failed in the full run (hel1572 mono clipping probe counted the deliberately collapsed nav labels: probe now skips opacity-0 text; hel813 surface 7 430px sans: a one-off Add connector dialog timeout under load, 12/12 on repeat); the six affected spec files re-run: 119 passed
