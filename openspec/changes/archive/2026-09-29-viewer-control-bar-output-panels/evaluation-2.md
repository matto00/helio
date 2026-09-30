## Evaluation Report — Cycle 2 (evaluation-2.md)
Reviewed HEAD 392b97ea2c22648a011241e435cffdfe8366f3b6 (code commit over 3415890b: PublicOutputControlScope/PublicDashboardRoutes/spec + PublicDashboardViewerPage.css).

### Phase 1: Spec Review — PASS
- CR1 (C11) resolved. Live probes with a share token, panel with a single `region` control:
  - `filter={"quick":"01-02"}` -> 400 "quick filter is not permitted on a public panel" (was 200 matching created_at).
  - `sort=amount:desc` (non-control) -> 400; `sort=region:desc` (control) -> 200 and sorted.
  - `filter ops amount eq` -> 400; `columns region` -> 200 narrowed; `quick:""` (empty) -> 200 unfiltered; plain read 200.
- Cycle-1 security matrix still holds (unconfigured column 400, other panel 404, missing/invalid token 404, capabilities narrowed).
- Saved panel config verified unchanged after URL-driven selection in fullscreen (GET panels config identical: controls + outputId only).

### Phase 2: Code Review — PASS
Fresh runs: lint clean; format:check clean; frontend build OK; jest frontend 367 suites/3945 pass, helio-mcp 271 pass; `sbt test` 4927 passed, 0 failed. No flakes. Diff is minimal and targeted; new backend tests cover quick and sort rejection.

### Phase 3: UI Review — PASS
- CR2 resolved: `.public-dashboard-viewer__panel-row` now column/stretch/min-width:0. Public viewer at 1440 light: title, control, full-width table stacked cleanly (eval2-pub-1440-light.png). At 390 dark: stacked, no page-level horizontal overflow (scrollWidth 390), table scrolls inside its own region (eval2-pub-390-dark.png). The max-width 720->1200 change is reasonable (table content needs width; container still centered, tokens for spacing unchanged); flagged for the skeptic as a visual judgment only.
- Public in-panel quick filter on the anonymous viewer is client-side (no `/rows` request sent, no 400/error state) and column sort click produces no server request: nothing regresses against the new 400s.
- Live authenticated: desktop grid, fullscreen overlay (control shown, changing east->west updates URL and rows, syncs with grid, "1 result." announced), detail modal (Customize) shows control bar with the filtered row, chart panel (temporary `name` dropdown control; Beta -> single Beta bar, request carried `filter={"ops":[{"column":"name","op":"eq","value":"Beta"}]}`; fixture control removed afterward), phone width authenticated (cycle 1). Console clean on tested public flows.
- Not driven live: the stale-response guard (rapid control changes); covered by unit tests (PanelCard/MobilePanelStack staleFetchSequencing, usePanelSortFilter).

### Overall: PASS

### Non-blocking Suggestions
- Public quick filter is client-side, so the live-region text says "3 results." while 1 row is visible after typing a quick term (observed at 390).
- On load with a URL-held control value the chart panel first issues one unfiltered `/rows` read then the filtered one (visible in network log); consider suppressing the initial unfiltered fetch.
- `PublicOutputMetaResponse.ownerId` still sent to anonymous callers (from cycle 1).
