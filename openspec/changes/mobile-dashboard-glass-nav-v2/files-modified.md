# Files modified (Phase A: tasks 1 and 2)

- `frontend/src/features/panels/ui/PanelList.css` — phone `.panel-list` inline inset 20px -> 12px (`--space-3`); zoom widget hidden across the whole <= 768px shell; retired the <= 768px `bottom: calc(--bottom-nav-height + ...)` rule and the <= 430px-only hide.
- `frontend/src/features/panels/ui/PanelList.tsx` — mounts `DashboardChipRow` on the phone shell; no zoom widget there, effective zoom 1.0, ctrl/meta-wheel inert, saved level untouched (D2).
- `frontend/src/features/panels/ui/grid/MobilePanelStack.css` — phone-shell gutters: stack padding 0, 10px gap, 14px card padding, no nested inline inset on markdown/text bodies (D1).
- `frontend/src/features/panels/ui/grid/mobilePanelHeights.ts` — stack chrome constants re-derived (container padding 0, card 30px incl. border).
- `frontend/src/features/dashboards/ui/DashboardChipRow.tsx` / `.css` — new chip row: session-stable order, cap 12, tap = select + navigate, active chip filled with `aria-current`, own `scrollLeft` reveal (D3-D5).
- `frontend/src/features/dashboards/ui/DashboardChipRow.test.tsx`, `DashboardChipRow.css.test.ts` — RTL (order, cap, remount stability, tap, chip A -> sheet B -> chip A, aria-current, scrollLeft) and CSS pins.
- `frontend/src/features/panels/ui/PanelList.phoneShell.test.tsx`, `PanelList.css.test.ts` — phone-shell render/zoom-inert tests and CSS pins.
- `frontend/src/features/panels/ui/grid/MobilePanelStack.css.test.ts`, `mobilePanelHeights.test.ts` — gutter pins and the recounted chrome width.
- `frontend/src/theme/elevationTokenGuard.css.test.ts`, `motionTokenGuard.css.test.ts` — CSS file-count pins recounted 135 -> 136 (new `DashboardChipRow.css`).
- `frontend/src/theme/theme.css` — stale comment about the zoom-widget clearance.
- `e2e/hel1583-mobile-dashboard.spec.ts` — new e2e: gutters, chips, zoom absence, bottom clearance, per-width/theme measurements and screenshots.
- `e2e/hel813-mobile-touch-target-floor.spec.ts` — surface 6: zoom widget is hidden at both 430 and 768 now.
- `e2e/hel1023-breakpoint-layout-derivation.spec.ts` — phone-stack container 360 -> 376 (12px inset per side).
- `openspec/changes/mobile-dashboard-glass-nav-v2/{tasks.md,measurements.md,files-modified.md}` — task ticks, rendered-pixel measurements (screenshots in the gitignored `evidence/`).

## Cycle 2 (evaluation-1.md CR1-CR3)
- `frontend/src/features/dashboards/ui/DashboardChipRow.css` — `min-width: 44px` (short-name chips), `height: var(--control-md)`, transition from `--motion-duration-quick`/`--motion-ease-standard`.
- `frontend/src/features/dashboards/ui/DashboardChipRow.css.test.ts` — pins for min-width, control token, motion tokens.
- `e2e/hel1583-mobile-dashboard.spec.ts` — a "Q" dashboard with an elementFromPoint hit-area bisection (>= 43px each axis); the active chip must end inside the row after a tap, independent of fixture order.

# Phase B (cycle 3: tasks 3.0-3.6)

- merge of `origin/main` (d777803c1, HEL-1575/1576/1578/1572/1579) — conflicts only in the two CSS file-count pins (recounted with `find`: 148), and `e2e/hel813-mobile-touch-target-floor.spec.ts` (took main's STYLES matrix, re-applied the zoom-hidden surface 6).
- `frontend/src/shared/chrome/navDestinations.ts` — `activePrefixes`, `MenuNavTab`/`PhoneNavTab`, `phoneNavTabs` (Home, Dashboards, Data, Pipelines, Me), `dataSectionLinks`; `isDestinationActive` extended (no parallel matcher).
- `frontend/src/shared/chrome/BottomNav.tsx` / `BottomNav.css` — five tabs from `phoneNavTabs`; Me menu tab; expanding label; opaque `--app-surface-strong` active pill with 1px `--app-text` inset ring; `flex: 0 1 auto` + `space-evenly`; label/padding transition on motion tokens, gated for reduced motion / Off.
- `frontend/src/shared/chrome/DataSectionTabs.tsx` (+ pill link rules in `features/dashboards/ui/DashboardChipRow.css`) — phone "Sources | Connectors" row mounted on `SourcesPage` and `ConnectorsPage`.
- `frontend/src/features/auth/ui/UserMenu.tsx` / `.css` — `tabTrigger` + `placement="nav"` so the Me tab reuses the menu.
- `frontend/src/app/CommandBar.tsx` — phone header avatar removed.
- `frontend/src/app/dashboardMeta/RefreshFact.tsx`, `DashboardRefreshLine.tsx`, `DashboardMetaFacts.tsx`, `DashboardMetaRow.css` — shared refresh-fact helper extracted; phone refreshed caption.
- `frontend/src/features/panels/ui/PanelList.tsx` — mounts the refreshed line above the chip row on the phone shell.
- `frontend/src/theme/appearance.ts` (comment), `accentTextSourceSyncGuard.css.test.ts` (rewritten: every CSS inline tint is scored, 0.22 retained), `elevationTokenGuard.css.test.ts` (pin for the ring; count 148), `motionTokenGuard.css.test.ts` (count 148).
- Tests: `BottomNav.test.tsx`, `BottomNav.css.test.ts`, `navDestinations.test.ts`, `DataSectionTabs.test.tsx`, `DashboardRefreshLine.test.tsx`, `AppShell.rail.test.tsx`, `PanelList.phoneShell.test.tsx`.
- e2e: `hel1583-glass-nav.spec.ts` (new), `hel1583-home-375.spec.ts` (new, task 3.5a), `hel1574-shell-rail.spec.ts` (five phone tabs, Me replaces header avatar), `hel813-mobile-touch-target-floor.spec.ts` (Me tab bisection).
- `DESIGN.md` — §3 carve-out (opaque pill, label floor), §12 (five tabs, expanding tab, refreshed line), accent-text 22% text.

## Declared paths (canonical, for squash-branch.sh)

- `DESIGN.md`
- `e2e/hel1023-breakpoint-layout-derivation.spec.ts`
- `e2e/hel1572-appearance-preferences.spec.ts`
- `e2e/hel1574-shell-rail.spec.ts`
- `e2e/hel1583-glass-nav.spec.ts`
- `e2e/hel1583-home-375.spec.ts`
- `e2e/hel1583-mobile-dashboard.spec.ts`
- `e2e/hel813-mobile-touch-target-floor.spec.ts`
- `frontend/src/app/AppShell.rail.test.tsx`
- `frontend/src/app/CommandBar.tsx`
- `frontend/src/app/dashboardMeta/DashboardMetaFacts.tsx`
- `frontend/src/app/dashboardMeta/DashboardMetaRow.css`
- `frontend/src/app/dashboardMeta/DashboardRefreshLine.test.tsx`
- `frontend/src/app/dashboardMeta/DashboardRefreshLine.tsx`
- `frontend/src/app/dashboardMeta/RefreshFact.tsx`
- `frontend/src/features/auth/ui/UserMenu.css`
- `frontend/src/features/auth/ui/UserMenu.tsx`
- `frontend/src/features/connectors/ui/ConnectorsPage.tsx`
- `frontend/src/features/dashboards/ui/DashboardChipRow.css`
- `frontend/src/features/dashboards/ui/DashboardChipRow.css.test.ts`
- `frontend/src/features/dashboards/ui/DashboardChipRow.test.tsx`
- `frontend/src/features/dashboards/ui/DashboardChipRow.tsx`
- `frontend/src/features/panels/ui/PanelList.css`
- `frontend/src/features/panels/ui/PanelList.css.test.ts`
- `frontend/src/features/panels/ui/PanelList.phoneShell.test.tsx`
- `frontend/src/features/panels/ui/PanelList.tsx`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.css`
- `frontend/src/features/panels/ui/grid/MobilePanelStack.css.test.ts`
- `frontend/src/features/panels/ui/grid/mobilePanelHeights.test.ts`
- `frontend/src/features/panels/ui/grid/mobilePanelHeights.ts`
- `frontend/src/features/sources/ui/SourcesPage.tsx`
- `frontend/src/shared/chrome/BottomNav.css`
- `frontend/src/shared/chrome/BottomNav.css.test.ts`
- `frontend/src/shared/chrome/BottomNav.test.tsx`
- `frontend/src/shared/chrome/BottomNav.tsx`
- `frontend/src/shared/chrome/DataSectionTabs.test.tsx`
- `frontend/src/shared/chrome/DataSectionTabs.tsx`
- `frontend/src/shared/chrome/navDestinations.test.ts`
- `frontend/src/shared/chrome/navDestinations.ts`
- `frontend/src/theme/accentTextSourceSyncGuard.css.test.ts`
- `frontend/src/theme/appearance.ts`
- `frontend/src/theme/elevationTokenGuard.css.test.ts`
- `frontend/src/theme/motionTokenGuard.css.test.ts`
- `frontend/src/theme/theme.css`
