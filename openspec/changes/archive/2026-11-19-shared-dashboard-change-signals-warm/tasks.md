## Standing Constraints

- [C1] Never read/cat/grep/source/print any .env file, never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); only scripts may read scripts/concertino/.concertino.env, never print it; never copy .env files.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with scripts/concertino/stop-servers.sh; delete test residue by exact id (buildUserDeleteSql); plain emails.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; `sbt testFull` (sharded to fit the timeout), never a background run past the tool timeout.
- [C6] Red first with mutations; full spec files; the red run is recorded AND committed before implementation code.
- [C7] Scratch in .concertino/scratch/HEL-1783/.
- [C8] Lane-private DB helio_hel1783 (createdb); DATABASE_URL set for start-servers.sh AND Playwright; DB_USER when DATABASE_URL has no credentials; backend started with ANTHROPIC_API_KEY exported empty.
- [C9] Gates grep e2e/ for every selector, accessible name or text the change alters.
- [C10] Non-owned dashboards: never a request to /api/outputs/* or /api/pipelines/*; prove RLS as helio_app (NOBYPASSRLS).
- [C11] Do not touch HEL-1784 files (FormRenderer.tsx, FormPanelView.tsx, PanelService, form-schema route, ApiRoutes.scala wiring) or HEL-1778 files (CI e2e shard weights, workflows). No migration (if unavoidable: V147, report it).
- [C12] No prod, no release, no concertino sync; no claude.ai session link in commits.
- [C13] (skeptic-design-6 CR1, owner-approved binding) Under a restore marker, `usePanelData`'s first-mount non-refresh branch builds its query from the window's full `lastQuery` (sort, full filter incl. quick/columns/ops, crossFilterEq per the existing still-active rule), not `replayableQuery(full=false)`; no marker = byte-identical. Equivalent alternative: defer while marker present and scoped meta unresolved, proving a failed/never-resolving meta read falls back to exactly one fetch and never wedges. Never persist the scoped meta stub. Name the mechanism in files-modified.md.
- [C14] (skeptic-design-6 CR2) The stored-copy jest case asserts ZERO rows requests across the whole first mount, variants: persisted default `columnSort`, persisted `columnFilters`, URL control filter; plus a persisted default that differs from the captured window's query → exactly one per-panel rows request.
- [C15] (skeptic-design-6 CR3) m12 (parent uses the stripped mount query under a marker) turns the sort and column-filter variants red; m11 shown red on the URL-control-filter variant; e2e (d)'s Output has a persisted default `columnSort`.
- [C16] Avoid HEL-1782 (viewer shell polish, `dashboardsSlice` getMostRecentDashboardId) and HEL-1775 (ask drawer, editor preview chart) files; report it if `dashboardsSlice` is touched.

## 1. Red first

- [x] 1.1 Create lane DB `helio_hel1783`; record the exact DATABASE_URL form used (no secrets printed) in files-modified.md. Verify: `psql -l` lists it.
- [x] 1.2 Backend grantee/RLS spec (design D5) written; run it red (grantee `dataUpdatedAt` null / `outputs` empty) and save the transcript to `.concertino/scratch/HEL-1783/red-backend.txt`.
- [x] 1.3 Jest cases for capture, restore, scope match and panel-status seeds (design D5) written, `warmNonOwner.test.ts` inverted; run red, transcript saved.
- [x] 1.4 `e2e/hel1783-shared-dashboard-tabs.spec.ts` written; run red at its first feature assertion against lane servers; transcript saved.
- [x] 1.5 Commit the red tests and transcripts before any implementation change. Verify: `git log` shows the red commit first.

## 2. Backend (D1)

- [x] 2.1 Split `DashboardChangesRepository.changes` into content (user context) then data (system context, readable ids only). Verify: 1.2 spec green; existing `DashboardChangesRoutesSpec` and home-summary specs green.
- [x] 2.2 RLS transcript as `helio_app` (labelled statements, 0 rows on `outputs`/`output_snapshot_history` for the grantee while the route returns times) saved to `.concertino/scratch/HEL-1783/rls-helio-app.txt`; deep-history timing re-measured for the grantee.

## 3. Frontend (D2-D4)

- [x] 3.1 Factor `applyPanelReadScopes` out of `fetchPanels`; use it in `restoreFromMemory`. Verify: existing panelThunks/outputMetaCache tests green.
- [x] 3.2 Capture non-owned dashboards with `readScope: "panel"`, empty `outputMeta`/`runBaseline`. Verify: jest capture cases green.
- [x] 3.3 Restore gated on known role + matching `readScope`; panel restore scopes Outputs and ignores meta/baselines. Verify: jest restore cases green; owner warm tests unchanged.
- [x] 3.4a Restore-marker row reuse rule for scoped Outputs in `isReusable` (design D3b). Marker visible to every `isReusable` call of the first mount after a restore (incl. the metadata-resolved correction), gone for any later mount. Verify: jest reuse + marker-consumption cases green; owner reuse tests unchanged.
- [x] 3.4 `seedPanelStatusBaseline` in `panelStatusStore`, called by panel restores. Verify: jest seed cases green.

## 4. Verification

- [x] 4.1 e2e 1.4 green (full file), plus `hel1575-*`, `hel1773-viewer-grantee-dashboard`, `hel1780-*`, `hel1786-*` specs green against the lane servers.
- [x] 4.2 Mutations m1-m12 (m10a, m10b) (design D5) each red at its own assertion, then reverted; transcripts saved.
- [x] 4.3 Gates: lint, typecheck, format:check, jest (3 workers), `sbt testFull` (sharded), pre-commit hook; grep `e2e/` for altered selectors and report hits.
- [x] 4.4 files-modified.md lists every file, intended assertion changes and their reasons.
