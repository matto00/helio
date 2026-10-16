# HEL-1576 UI decisions (for the PR body)

Owner answers (escalation HEL-1576-1792053980784-c95b08): (1) `meta-row-replaces-command-bar`, (2) `drag-only-in-edit`, (3) `tidy-layout`. D1, D4 and D8 are those owner decisions, not overnight ones.

## Overnight, reversible decisions

- **D2 dividers counted.** The panel count is every panel on the dashboard, dividers and text included, matching what the grid renders. Alternative: count data panels only.
- **D2 failed-run copy.** A failed latest run reads "last run failed 9 hours ago" with a danger dot; a successful one "refreshed 9 hours ago" with a success dot; never run "not refreshed yet"; unknown (no pipeline access or no output panels) omits the item. Alternative: always "refreshed" with a danger dot.
- **D3 narrow-width ladder.** Content-width thresholds 820 / 640 / 520 (+150 in edit mode), see `measurements.md`. Alternative: a single icon-only breakpoint. Deviation: the appearance editor stays in the row at every width (design D3 iii listed it for the kebab).
- **D3 borderless Share.** Every non-primary control in the row is the borderless chrome recipe because DESIGN.md §5 makes command-bar triggers borderless; the board's bordered Share is illustration. Alternative: a bordered Share (would break the [mechanical] chrome rule).
- **D3 pressed state.** "Done" uses the chrome wash pair `--app-surface-soft` (light) / `--app-surface-strong` (dark) with `--app-text`, the pair `.cmd-btn:hover` uses; never the accent. Alternative: `--app-surface-raised` (white on near-white in light, invisible).
- **D8 Tidy compacts all four breakpoints** in one action, one undo entry.
- **D8 authored-layout rule.** Tidy runs on the stored layout: an unauthored breakpoint (no entries, or an out-of-bounds entry the resolver treats as unauthored) is left as stored; a partial breakpoint has only its stored entries moved and gains none; stored entries of panels this tab has not loaded are kept verbatim. Alternative: tidy the resolved (derived) layout, which would write derived positions.
- **Facts drop whole.** When the row is too narrow the sources, then the refresh state, disappear whole instead of ellipsising to a stub.
- **Edit layout only with a movable grid.** Below the `sm` boundary the read-only stack renders (for example at 820px with the context list open), so Edit layout and its tools are not offered there. The meta row learns this from `desktopGridDashboardId` in the layout-history slice; leaving the movable grid ends edit mode.

- **Tidy compacts live entries only.** A stored entry for a panel this tab has not loaded is kept as stored and ignored when compacting, so it can end up overlapped by a moved panel; the HEL-1233 stored-layout repair would then flag that breakpoint as stored-bad on the next open. This mirrors the drag path (HEL-1457) and is deliberate; the alternative (treating unloaded entries as obstacles) would let an invisible item block a visible gap.
- **Focus after Tidy.** A successful Tidy disables itself ("Nothing to tidy"), so focus moves to Undo.
- **Short-card rhythm (D11).** 4-row cards take 12px block padding and an 8px gap so the chart canvas floors survive the 12px gutter.

## Notes for the PR

- HEL-1575: its `hideDashboardBreadcrumb` becomes unreachable on the rail-shell dashboard view (the command bar no longer renders there); the second lane to merge folds that rule into `usesDashboardMetaRow` / `hidesBreadcrumbItemName`. If this lane merges first, the command-bar breadcrumb on non-dashboard pages is unchanged.
- Follow-up: the minimum-height form panel overflows its box (pre-existing, 18px worse at the 12px gutter); numbers in `measurements.md`.
- The live checks ran against a scratch database because the shared dev DB is ahead of this branch's migrations (see `measurements.md`).

## Screenshots (`/home/matt/Development/helio/.concertino/runs/HEL-1576/evidence/screenshots/`)

`live-{dark,light}-{1280,820,768,375}.png`, `metarow-*.png`, `ladder-*.png`, `chrome-*.png`, `tidy-{workouts,roadmap-copy}-{1-before,2-editing,3-after}.png`, `content-fit/`.
