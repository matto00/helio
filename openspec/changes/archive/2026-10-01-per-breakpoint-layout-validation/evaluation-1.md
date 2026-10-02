## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 364f7e29feddeae4844dad0bcf028a6fa0fba80c.

### Phase 1: Spec Review — PASS
Issues: none. AC1-3,5,6,7 implemented; AC4 untouched (out of scope, "what it takes" documented in execution-progress.md). C1-C6 honored: out-of-bounds rejected with breakpoint+ids; identical/absent/changed rule in LayoutPolicy; nothing written on reject (layout resolved before rename write).
Write-path enumeration re-derived independently (grep of dashboardRepo.update/insert/replaceContents/layout =): DashboardService.update (both PATCH routes), AutoLayoutService, PanelService.placeDefaultLayout (per-bp bottom), proposal apply, contents replace, import, duplicate (faithful, exempt), patch-set rollback/undo (RestorePriorStored, private[services]), patch-set preview, first-run (audited by test), DashboardService.create (empty default). All covered or explicitly exempt; none missed.

### Phase 2: Code Review — PASS
Gates run fresh by me:
- `cd backend && nice -n 19 sbt testFull`: Tests succeeded 5191, failed 0 (no HEL-1228/1215 flake appeared).
- `npm run lint`, `format:check`, `typecheck`, `check:schemas`, `check:openspec`: clean.
- `npm --prefix frontend test`: 408 suites / 4252 tests pass.
- root jest helio-mcp: 31 suites / 315 tests pass.
Mutation (done by me, files restored via git checkout, git status clean): flipping each of the four strict inequalities in the overlap predicate fails the fixture test on BOTH sides (frontend 1/5/1/2 failures; backend LayoutValidatorSpec 1/3+/1/2 failures). Shared fixture parity is real.
Lockout tests present in DashboardLayoutValidationSpec (stored-bad xs + changed lg riding along, whitespace identity, changed-still-bad rejects, repaired accepted, both routes) plus frontend layoutPatch / DesktopPanelGrid.layoutPatch tests (undo-to-bad substitution, baseline from server response).
MCP behavior verified through repo jest tests (helioApi.test.ts, layoutHandlers.test.ts), not a live connection.

### Phase 3: UI Review — PASS
Servers via start-servers.sh (default 120/60s rate limit left in place; traffic was far below it). Logged in as matt@helio.dev; created dashboard b329926e-f5b6-4042-b78b-c409ab162ac7 and markdown panels e78596e8-b767-44e5-b0d4-94ada37ceb46, cebd9ddd-24dc-423e-b9ce-3d9524bbf36f, 33da67f0-f6c5-412d-8ad5-e89d2c6d4bb6; all four deleted by exact id (204 each), session logged out.
- Grid renders 3 panels, no layout breakage, no unexpected console errors (only the expected 401 auth probe and my two deliberate 400s).
- Using the exact wire shape the grid sends (`PATCH /update {fields:["layout"],dashboard:{layout}}`): overlapping xs -> 400 naming breakpoint 'xs' and both ids; out-of-bounds md -> 400 with 10-column message; valid lg-only -> 200; valid xs-only -> 200 with lg unchanged. Verified by re-reading stored layout.
- LIMITATION: the browser tool has no pointer-drag primitive and synthetic mouse events did not trigger react-grid-layout, so I could not perform a literal UI drag. "Grid still saves a drag" is evidenced by the wire-shape PATCH above plus the jest tests (DesktopPanelGrid.layoutPatch/layoutCommit/derivedLayout, useLayoutSave via buildLayoutPatch), not a live drag. Not treated as a defect.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- DashboardService.scala is 431 lines (over the ~400 split-proposal line); executor already noted a split proposal (validateImportPanels) for the PR description.
- Dev servers: I killed the two listening PIDs (6503/9410); `sbt --client shutdown` reported no server running.
- Not cleaned (no API): audit_events rows and one revoked user_sessions row from my login.
