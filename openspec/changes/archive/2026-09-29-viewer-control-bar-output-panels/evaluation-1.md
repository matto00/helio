## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed HEAD 3415890bd121bec5e6230a6d4e7689bd7b268e7a against base 22c9ee1f.

### Phase 1: Spec Review — FAIL
- C11 (owner ruling) not fully honored: on the public route an anonymous/share-token caller may filter using `filter={"quick":...}` across ALL sortable columns, not only the panel's control columns, and `sort=<any column>:dir` on any column. `PublicOutputControlScope.validateFilterColumns` explicitly exempts `quick` (PublicOutputControlScope.scala namedColumns doc). Live repro (share token on dashboard e690e243, panel with a single `region` control): `filter={"quick":"01-02"}` returns 1 row matched on non-control column `created_at`; `filter={"columns":{"amount":"10"}}` correctly returns 400. Note: the rows route already returns every column of every row unfiltered, so no extra data is exposed, but the ruling is literal ("only filter ... on columns configured as controls") and design.md never records `quick`/`sort` as a deliberate exemption.
- Everything else in C11 verified live: unconfigured column 400 (rows + distinct-values), other panel id 404, no/invalid token 404, filter-capabilities narrowed to control columns only, no caller-supplied output id anywhere.
- C12/C13: layered commits and PanelContent reuse confirmed.
- Red-first (public layer): base PublicDashboardViewerPage.tsx renders only title + `panel.type` (line 86) and never calls the rows route; head renders the real table. Controls layer: URL round-trip verified (reload of `?p.<panel>.<control>=east` shows 2 rows; authenticated `=west` shows 1 row, combobox shows "west"; request carries `filter={"ops":[{"column":"region","op":"eq","value":"east"}]}`).

### Phase 2: Code Review — PASS (gates)
Fresh runs in WORKTREE_PATH: `npm run lint` clean; `format:check` clean; `npm test` frontend 367 suites/3945 tests pass, helio-mcp 271 pass; `npm --prefix frontend run build` OK; `sbt test` 4925 passed, 0 failed. No flakes observed.

### Phase 3: UI Review — FAIL
- Public viewer layout breakage: PublicDashboardViewerPage.css is untouched, and `.public-dashboard-viewer__panel-row` is `display:flex; align-items:center; justify-content:space-between` (row direction). The title, control bar and table now sit side by side; at 390px the table is crushed to ~110px wide showing only the `amount` column (evidence: eval1190-pub-phone-dark.png, persisted via persist-evidence.sh; also cramped at 1440). The row needs a column layout (title above, control bar, then content full width) for output-kind panels. Dark theme tokens rendered correctly.
- Passed: public happy path (real table, dropdown options from panel-scoped distinct-values, "N results." live region announced), no console errors, authenticated desktop grid (control bar renders cleanly, cohesive), authenticated phone width with URL-applied filter, combobox has accessible name.
- Not exhaustively re-driven live: fullscreen overlay, detail modal, chart panels (covered by unit tests only).

### Overall: FAIL

### Change Requests
1. Gate `quick` (and `sort`) on the public route by the panel's control columns, or, if `quick`/`sort` are to be allowed publicly, record that as an explicit, owner-acknowledged exemption in design.md and the public-dashboards spec. Simplest: reject any `quick` term (and any `sort` column not in `PublicOutputControlScope.allowedColumns`) with 400 in `PublicOutputControlScope.validateFilterColumns` / `resolveRows`, and make sure the public frontend does not send them; add a PublicDashboardRoutesSpec test for each.
2. Fix public viewer layout: in `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.css` (and the row markup in PublicDashboardViewerPage.tsx) stack title / control bar / panel content vertically with content at full width for output-kind panels (flex-direction: column, align-items: stretch, or a dedicated content class using --space-* tokens); verify at 1440 and 390 in both themes.

### Non-blocking Suggestions
- `PublicOutputMetaResponse.ownerId` is sent on the wire to anonymous callers though the client discards it; consider omitting it server-side.
