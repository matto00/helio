## Skeptic Report — final gate (round 1, skeptic-final-1.md)
Reviewed HEAD 392b97ea2c22648a011241e435cffdfe8366f3b6.

### What I verified (with evidence)
- Read PublicOutputControlScope.scala and the PublicDashboardRoutes diff: every public route (rows, filter-capabilities, distinct-values, output-meta) resolves the panel via findAllByDashboardId under the same authorizeResourceWithSharing gate as before; no caller-supplied output id; column allow-list derived server-side from the panel's own controls; quick rejected; sort limited to control columns.
- Live C11 attack matrix against the running backend (cwd confirmed as this worktree), fresh share token, panel with a single `region` dropdown control:
  plain 200; quick "a" 400; columns{amount} 400; ops amount 400; sort=amount 400; ops region eq 200 (2 rows); nonexistent panel 404; other dashboard id 404; no token 404; bad token 404; distinct-values region 200, amount 400, no token 404; filter-capabilities narrowed to region only; authenticated /api/outputs/:id/rows and distinct-values with only a token 401.
- Visual, public viewer as anonymous URL: 1440 light (table full width, control bar above, 1200 container reads well), 1440 dark, 390 dark (stacked, table scrolls inside its region, no page overflow). Screenshots: .playwright-mcp/sk-pub-1440-a.png, sk-pub-1440-dark.png, sk-pub-390-dark.png. Selecting "west" wrote `p.<panel>.<control>=west` to the URL, narrowed to 1 row, live region "1 result."; reload with the URL reproduces it (control shows "west" once loaded, both themes). Column sort on public works client-side (aria-sort ascending), no error.
- Targeted jest (viewerControlValues, useViewerControls, OutputViewerControlBar, PublicDashboardViewerPage, staleFetchSequencing, usePanelSortFilter): 8 suites / 52 tests pass. Evaluator's full-suite runs (sbt 4927, jest 3945) relied on as pasted counts.
- Authenticated paths (grid, fullscreen, modal, chart, phone) rely on evaluation-1/2 live evidence; I did not re-drive them.

### Judgment on the evaluator's non-blocking notes
- Public quick-filter live-region count mismatch: acceptable (quick is client-side by design after C11; minor a11y imprecision), worth a follow-up.
- Chart with URL-held value issuing one unfiltered /rows first: acceptable, wasted request, no wrong rendering.
- ownerId on public output-meta: low-severity disclosure of an owner UUID to anonymous callers; not required by any consumer per the route doc; recommend dropping in a follow-up. Not a blocker (the dashboard owner id is already exposed on shared dashboards).
- Stale-response guard unit-tested only: acceptable, reuses HEL-1027's guard with tests.
- Minor: on cold load with a URL value the public control briefly shows "All" before hydrating; transient.

### Verdict: CONFIRM
