## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); only scripts/concertino/.concertino.env may be read by scripts, never printed. Do not copy .env files around.
- [C2] Quoted heredocs only (<<'EOF'), even when the body looks harmless.
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue with buildUserDeleteSql by exact id; plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull, never bare sbt test.
- [C6] Every lane backend is started with ANTHROPIC_API_KEY exported empty (ANTHROPIC_API_KEY= before start-servers.sh); no live model call is authorised; insight renders are seeded rows.
- [C7] Lane-private DB helio_hel1780 (createdb); DATABASE_URL set for start-servers.sh AND Playwright (e2e/support/db.cjs silently falls back to the dev DB without it); DB_USER too when DATABASE_URL has no credentials. Dropped at Delivery.
- [C8] Red first, with mutations; write tests before code in every stage; run full spec files; record the red runs.
- [C9] Scratch in .concertino/scratch/HEL-1780/.
- [C10] Gates grep e2e/ for every selector/accessible name the change alters.
- [C11] Invariant: while a non-owner views a shared dashboard, zero requests to /api/outputs (any suffix) or /api/pipelines, no /api/* 4xx/5xx, no console errors. Dev/CI is BYPASSRLS, so routing proof is the helio_app (NOBYPASSRLS) run, never a local 200.
- [C12] History payload rows stay unreachable for a dashboard-only grantee; no per-panel payload route is added. PublicOutputControlScope (C11 ruling) is not changed. No new backend route; a migration, if ever needed, is V146 and the driver is told.
- [C13] Avoid HEL-1776's files (actions-menu Tab handling, shared popover focus code). No prod, no release, no concertino sync; no claude.ai session link in commits/PRs.

## 1. Red: reproduce the hidden features as a grantee

- [x] 1.1 Create the lane DB `helio_hel1780`; start servers with `ANTHROPIC_API_KEY=` and DATABASE_URL (C6/C7).
- [x] 1.2 Write `e2e/hel1780-shared-dashboard-panel-features.spec.ts` per design D10 (viewer, editor, dual-grant user, switch step, phone pass), with the C11 invariant.
- [x] 1.3 Run the full spec on unchanged code; record red at the first feature assertion, for the right reason (feature hidden), in `.concertino/scratch/HEL-1780/`.
- [x] 1.4 Backend spec per D9 (viewer/editor/dual-grant/stranger on every per-panel route; non-control column 400; history has no id/hasPayload); run with `sbt testFull` scoped to the spec class; record results.
- [x] 1.5 RLS transcript as `helio_app` per D9 (outputs 0 rows for dashboard-only viewer/editor; gate admits viewer/editor, refuses stranger; payload rows 404); save `rls-helio-app.txt` and persist it.

## 2. Frontend: per-panel read scope

- [x] 2.1 Jest first: `usePanelReadScope` (owner/editor/viewer/unknown, panel's own dashboardId vs selected dashboard). Plus: `fetchPanelPage` for a panel whose dashboard is absent from the store calls `fetchPublicPanelRows`, never `getOutputRows`. Then implement (D1: one fail-closed `panelReadScopeFor`, `dashboardId` a required `fetchPanelPage` arg) and migrate every `useCanUseOutputRoutes` site; delete the helper if unused; state each Output-keyed seam's disposition in files-modified.md. Planned fixture migration (D1): seed the panel's dashboard as owned in each existing owner-path test that seeds none (grep in design D1), seeding only, listed under "D1 planned fixture migration"; `renderWithStore` does not auto-seed. Grep every production mount of the migrated components and list how each one's dashboard is in the store.
- [x] 2.2 Jest first: token-optional per-panel services (distinct values, filter capabilities, provenance, history, insight, rows with sort/filter) omit `token` when absent. Then implement (D2).

## 3. Frontend: features

- [x] 3.1 Jest first, then implement: viewer controls + distinct values in panel scope (D3).
- [x] 3.2 Jest first (`splitForPanelScope` case table; `fetchPanelPage` panel-scope forwards only server part, one case per dispatch site: initial/replay, sort change, load more, cross-filter retry — none sends a non-control column or `quick`; `crossFilterEq` folded only for a control column; `useTableRows` `clientOps` sorts/filters loaded rows with onSortChange wired; `LoadedScopeDisclosure` `clientScope` copy for sort-only/filter-only/both, hidden when every row is loaded; zero-match truncated empty state copy; one disclosure line only — every-row-loaded quick search 3 of 40 shows "3 results." never "40 results.", truncated variant renders one note; owner tests unchanged; D4(e) client-only change dispatches no fetchPanelPage and keeps loaded rows, server-part change still dispatches; m10), then implement (D4). `usePanelSortFilter` gains `dashboardId` (threaded from `PanelCardBody`).
- [x] 3.3 Jest first, then implement: cross-filter panel-scope decision (D5), capabilities keyed by (dashboardId, panelId); two panels on one shared dashboard bound to one Output with different controls each follow their own capabilities, and the 400 path invalidates the right key.
- [x] 3.4 Jest first, then implement: history/compare sparklines in panel scope (D6).
- [x] 3.5 Jest first, then implement: insight body via per-panel route; insight Refresh hidden for non-owners using the per-panel Output kind (D7, S1): `PanelCard` and `MobilePanelStack` insight panel in panel scope has no "Refresh <title>" (red on today's code), unknown-kind case hidden, non-insight card keeps Refresh.
- [x] 3.6 Jest first, then implement: provenance in every render path and PanelDetailModal view-mode controls/provenance (D8); binding stays read-only (R3).
- [x] 3.7 Update `e2e/hel1773-viewer-grantee-dashboard.spec.ts` hidden-feature assertions to the new behaviour; keep its invariant.

## 4. Green and mutations

- [x] 4.1 Full `hel1780` and `hel1773` e2e specs green (Playwright 2 workers, DATABASE_URL = lane DB).
- [x] 4.2 Mutations m1-m10 per D10 and D4(e), each red at its own assertion; transcripts saved and persisted.
- [x] 4.3 Gates: lint, typecheck, format, full jest (3 workers), backend spec(s), grep `e2e/` for every altered selector/accessible name (C10) and list hits in files-modified.md.
- [x] 4.3a Design-gate non-blocking notes (skeptic-design-5): D4(e) edge cases in code + jest — no window (`lastQuery` absent) always dispatches; last page-0 failed always dispatches; a client-only change during an in-flight page-0 compares against the in-flight query and the sync action never touches `latestFetchRequestId`. `clientOps` derives from the same intent `usePanelSortFilter` holds, with `config.controls` and the read scope threaded to `TableRenderer` from `OutputPanelContent` (never re-derived from the selected dashboard).
- [x] 4.4 `files-modified.md` lists every touched file and which decision it implements.
