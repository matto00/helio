## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ); the only exception is scripts/concertino/.concertino.env which scripts may read but never print.
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs only; stop servers with stop-servers.sh; test residue deleted by exact id.
- [C4] jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull, never bare sbt test.
- [C12] Red first, with mutations; run full spec files, not single tests.
- [C13] Scratch in .concertino/scratch/HEL-1773/.
- [C14] Lane-private DB helio_hel1773; DATABASE_URL set for start-servers.sh and Playwright.
- [C15] Gates grep e2e/ for every selector/accessible name the change alters.
- [C16] While a non-owner views a dashboard: zero /api/outputs/ or /api/pipelines/ requests, no 4xx/5xx /api responses, no console errors (dashboard-only grantees are refused there by RLS in prod; dev BYPASSRLS hides it).

## 1. Stage 1 — reproduce as a real viewer grantee (done, 206a72d00)

- [x] 1.1 Confirm the dashboard grant request body.
- [x] 1.2 Write `e2e/hel1773-viewer-grantee-dashboard.spec.ts`.
- [x] 1.3 Run the full spec; viewer red for the right reason.
- [x] 1.4 Mutations (a)(b)(c).
- [x] 1.4a Red: no RLS run for stage 1.
- [x] 1.5 Persist evidence, commit.

## 2. Red first (child 1)

- [x] 2.1 Extend the e2e per design.md D8. Run the full file on the unfixed branch; save `.concertino/scratch/HEL-1773/child1-red.txt`; it is red at the opens/list assertions (negative assertions cannot run there; they are proven by mutations m2-m8 in 5.1).

## 3. Backend

- [x] 3.1 `include=shared` opt-in on the list route (D0); `findAllVisiblePaged` with explicit self-grant exclusion (D1), delete `findAllVisible`, move its spec cases; `findAll` callers for assistant/search unchanged.
- [x] 3.2 `accessRole` on `DashboardResponse` (D3), `schemas/dashboards/dashboard.schema.json`, helio-mcp type; route + seam specs.
- [x] 3.3 RLS proof per D2, every statement labelled with the role it ran as (helio_app list/pipelineFed/outputs-0-rows; per-panel gate refusal for the stranger; per-panel data as helio_privileged); persist the transcript.

## 4. Frontend

- [x] 4.1 App list fetch passes `include=shared`; `Dashboard.accessRole`, fail-closed rule, preserve helper at every merge site, selectors incl. `selectOwnedDashboards`; owned-only landing and onboarding (D0, D3, D4) + tests.
- [x] 4.2 Shared marker and every list surface per D7 (sidebar, Home shelf + count, phone chip row/sheet, tab bar, palette) + a jest case each.
- [x] 4.3 Gating (D5); enumerate every affordance and its gate in files-modified.md.
- [x] 4.4 Per-panel read path and every named consumer in D6 hidden for non-owners (incl. useDashboardMeta, usePanelRunRefresh, data-invalid badge, usePipelineOwnership, warm cache, PanelDetailModal view/edit, TableRenderer.canWrite) + tests.

## 5. Verify

- [x] 5.1 Full e2e file green; mutations m1–m9 each red at its intended assertion; transcripts saved.
- [x] 5.2 Gates: lint, typecheck, format, jest (3 workers), `sbt -J-Xmx3g testFull`, plus `grep -rn` of `e2e/` for every altered selector/accessible name (C15) with results recorded.
