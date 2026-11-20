## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy, ...), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Only scripts/concertino/.concertino.env may be read by scripts, never printed. Never copy .env files.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue with buildUserDeleteSql by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; never a background run past the tool timeout.
- [C12] Red first with mutations; run full spec files; record and COMMIT the red run before implementation code.
- [C13] Scratch in .concertino/scratch/HEL-1782/.
- [C14] Lane-private DB helio_hel1782 (createdb); DATABASE_URL set for start-servers.sh AND Playwright; DB_USER when DATABASE_URL has no credentials. Backend started with ANTHROPIC_API_KEY exported empty. Drop the DB at Delivery.
- [C15] Do not touch HEL-1783's files (tab bar, features/dashboards/tabs/**, warm cache, usePanelData) or HEL-1778's (CI workflows, shard weights). dashboardsSlice.ts edits are limited to design.md D6/D7.
- [C16] Grep e2e/ for every selector or visible string the change alters, and run each hit's spec file in full.

## 1. Red tests (committed before implementation)

- [x] 1.1 Write the Jest tests listed in design.md D8 (meta row View only incl. tier 3, refresh line viewer, useLayoutUndoRedo viewer inert, CreateCommandActions viewer/editor, dashboardsSlice shared-only landing incl. after delete, DashboardShelf shared-only drop zone, PanelList shared-only drop zone vs owner "No dashboard open", DashboardList + sheet "Build your own dashboard" shown/hidden, chip badge CSS equality); the useLayoutUndoRedo viewer test seeds history via pushLayoutSnapshot with an editor companion (D8); rewrite dashboardsSlice.accessRole.test.ts:46 to owner ruling 1 by name; PanelList.test.tsx:313 stays unchanged; run them and confirm each fails for the right reason.
- [x] 1.2 Write `e2e/hel1782-viewer-shell.spec.ts` (design.md D8 scenarios), run it against the lane-private DB and record the red output in `.concertino/scratch/HEL-1782/red-run.md`; commit tests + red-run record.

## 2. Viewer read-only shell

- [x] 2.1 "View only" in DashboardMetaFacts for viewers at every tier (D1); verify with 1.1 tests green.
- [x] 2.2 "View only" in DashboardRefreshLine for viewers, fixed slot from first paint (D1); verify with tests + no layout shift on the running app.
- [x] 2.3 Gate useLayoutUndoRedo on selectCanEditDashboard (D2); verify with test.
- [x] 2.4 Grep every useCommandActions registrant for dashboard-editing entries; gate any found (D3); verify palette test.
- [x] 2.5 CTA audit recorded in `.concertino/scratch/HEL-1782/cta-audit.md`; add viewer branches for any edit-inviting CTA found (D4).

## 3. Phone

- [x] 3.1 Restyle `.dashboard-chip__shared` to the shared badge treatment, inverse pill on the active chip, cross-referencing comments (D5); verify CSS test + both themes on the running app.
- [x] 3.2 Verify pull-to-refresh and the Refresh dashboard button for viewer and editor (no /api/outputs or /api/pipelines request, no error UI); fix if broken (D5); verify via e2e.

## 4. Shared-only first run

- [x] 4.1 getMostRecentDashboardId falls back to the most recent shared dashboard when none owned (D6); verify slice tests.
- [x] 4.2 DashboardShelf shows the drop zone below the shelf for a shared-only user (D6); verify test.
- [x] 4.3 PanelList shows the drop zone instead of "No dashboard open" when the user owns none (D6); verify test.
- [x] 4.4 "Build your own dashboard" entry in the sidebar list and the phone sheet, only while none owned; selecting it navigates to /dashboards and clears the selection (D6); probe whether a refetch re-selects and apply the slice-local guard if so; verify tests + e2e.

## 5. Verification

- [x] 5.1 Mutation pass: one mutation per behaviour (D8), each turns its test red; record in `.concertino/scratch/HEL-1782/mutations.md`.
- [x] 5.2 Full gates: lint, typecheck, format:check, full frontend jest (3 workers), the new e2e spec plus every e2e spec hit by the C16 grep (incl. hel1575-dashboard-tabs, hel1773-viewer-grantee-dashboard), each run in full.
- [x] 5.3 Visual check against the running app in light and dark themes (desktop meta row, phone meta line, chips incl. active, Home shelf + drop zone, sidebar entry); screenshots under `.concertino/scratch/HEL-1782/`.
- [x] 5.4 Write `openspec/changes/read-only-viewer-shell-polish/files-modified.md`.
