## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed HEAD e944bc20fd096718cc5e44b5ba5cbafe89674dbc

### Phase 1: Spec Review — PASS
Issues: none. All 10 tasks ticked; every ticket scope item present (five render paths, public variant without link/ids, degraded states, Invalid-data badge, telemetry hook point, lazy + cached).

### Phase 2: Code Review — PASS
Gates run fresh in WORKTREE_PATH: `npm run lint` clean; `format:check` clean; `npm test` 384 suites / 4040 tests pass (helio-mcp 307 pass); `npm --prefix frontend run build` OK. No HEL-1215 flake occurred (no re-run needed). No backend files changed, sbt not run.
Grep: no `any`, TODO/FIXME in the diff. No issues.

### Phase 3: UI Review — PASS
Servers verified to serve THIS worktree: readlink /proc/<pid>/cwd -> .../HEL-1207/frontend (6639) and .../HEL-1207/backend (9546).
Red-first: main (2b73d638) contains no ProvenanceTrigger/popover (new files in diff); the main-branch footer had only a non-interactive "Invalid data" span.
Probe dashboard with table, chart, metric output panels + share token (cleaned up).
- Desktop grid: table/chart/metric popovers, dark and light (screenshots .playwright-mcp/ev1207-desk-{light-table,dark-chart,light-metric}.png). Right chain shown (source, pipeline, step path, last run relative, rows, checks, Open pipeline).
- Mobile stack @390: dark chart, light metric/table (ev1207-phone-*.png); trigger in header.
- Fullscreen overlay (light) and detail modal (light): popover portals into the dialog; Escape closes only the popover, focus returns to trigger, dialog stays open.
- Public viewer, anonymous (logged out, /api/auth/me 401): 390 light and 1440 dark; popover has no link, no ids; public API response carries no ids/ownerId; bad token -> 404.
- Lazy: 0 provenance requests on load (authed and public); after open+Escape+reopen on the same panel exactly 1 request (keyboard Enter open works).
- a11y: role=dialog with label "Data provenance for <title>", trigger aria-label + aria-haspopup/expanded, focus moves in, real Tab/Shift+Tab wrap inside, Escape closes, focus returns, Escape does not bubble to card/modal.
- Invalid data badge: no output had a failed assertion, so the assertion-status XHR was stubbed in-page (invalid:true). Badge rendered as a button, opened the same popover with focus on the Checks heading; network showed one assertion-status per output and a single provenance request, no second status fetch. This leg is stubbed-live plus unit-tested, not live against real failing data.
- Console: 0 errors in tested flows.
Dev-DB residue: created dashboard 1e610d3b-b721-445d-a574-4d2515ac0e3b, panels ca7f89d9-0ba3-4b33-aa23-9e0a1ec67b5b / 5acd1d03-f825-416e-842e-ca8dd14ac34c / cb24b15b-246a-44ea-9840-1a0168d8af5b, share token 9d306d6f-4bf8-4f21-addf-b76c98883097; all deleted by exact id (204), logged-in sessions logged out. No probe users/tokens.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- If the badge's status read disagrees with the later provenance read (status stale), the badge unmounts while open and close-focus targets a detached node; consider falling back to the icon trigger (openerRef.isConnected check).
- Backend returns rowCount null for both empty and absent snapshots, so an authenticated metric shows "Last run produced no rows" where the public endpoint showed 5 rows for a sibling panel; pre-existing ambiguity, documented in provenanceService.ts.
- Focus ring on the popover panel (tabindex -1) draws a second accent outline in light theme (skeptic's call).
