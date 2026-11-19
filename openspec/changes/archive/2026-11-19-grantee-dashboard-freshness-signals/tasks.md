## Lane constraints (driver, binding on every role)

- C1 Never read/cat/grep/source/print any `.env` file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Only `scripts/concertino/.concertino.env` may be read by scripts, never printed. Do not copy .env files.
- C2 Quoted heredocs only (`<<'EOF'`).
- C3 No pkill/pgrep/killall; exact PIDs only; stop servers with `scripts/concertino/stop-servers.sh`; delete test residue with `buildUserDeleteSql` by exact id; plain emails.
- C4 jest 3 workers, Playwright 2 workers, `sbt -J-Xmx3g`, `nice -n 19`.
- C5 Bash timeout 600000; `sbt testFull`, never bare `sbt test`; never run a suite in the background past the tool timeout.
- C12 Red first, with mutations; run full spec files; record and COMMIT the red run before implementation code.
- C13 Scratch in `.concertino/scratch/HEL-1786/`.
- C14 Lane-private DB `helio_hel1786` (`createdb`); `DATABASE_URL` set for `start-servers.sh` AND Playwright (`e2e/support/db.cjs` silently falls back to the dev DB without it); `start-servers.sh` also needs `DB_USER` when `DATABASE_URL` has no credentials. Backend started with `ANTHROPIC_API_KEY` exported empty (no live model call).
- No migration expected; if one becomes necessary it is V148 and the orchestrator must be told before writing it. Do not touch `PublicDashboardRoutes.scala`, `FormRenderer.tsx`, `FormPanelView.tsx`, `features/ask/**`, ask routes.
- A denied permission prompt is never retried or routed around: stop and report.

## 1. Red first (commit before implementation)

- [x] 1.1 Create lane DB `helio_hel1786`; record the commands in `.concertino/scratch/HEL-1786/setup.txt`. Verify: `psql` lists it.
- [x] 1.2 Write `DashboardPanelStatusRoutesSpec` per design D5 (helio_app/NOBYPASSRLS harness as `DashboardSharedListRoutesSpec`); run the full spec file with `sbt -J-Xmx3g "testOnlyFull ..."`-equivalent (whatever the repo's full-run single-spec command is; never bare `sbt test`) and save the red transcript to `.concertino/scratch/HEL-1786/red-backend.txt`. Verify: red for the right reason (route absent).
- [x] 1.3 Write `e2e/hel1786-shared-dashboard-freshness.spec.ts` per design D6 and the jest tests of D6 for the new pure functions/store/hook wiring (imports may target not-yet-existing modules only if the red reason is still the missing feature; prefer red-at-assertion). Run the full e2e file and the new jest files; save `red-e2e.txt`, `red-jest.txt`. Verify: e2e red at the first feature assertion (fact absent for the viewer).
- [x] 1.4 Commit the red tests and transcripts (`HEL-1786 Red: ...`). Verify: `git log -1` shows it.

## 2. Backend

- [x] 2.1 Factor `OutputService.assertionStatus`'s invalid rule into one shared internal function; the Output route keeps its exact behaviour. Verify: existing assertion-status specs pass unmodified.
- [x] 2.2 Add the response protocol, `schemas/dashboards/dashboard-panel-status-response.schema.json` (`additionalProperties: false`), the resolver (per-pipeline reads once per request, panel order, `runStatus` mapping, `dataUpdatedAt` from the latest history point, `sources` via the factored `ProvenanceService.sourcesFor` that `forOutput` also calls; no `forOutput` and no `count(*)` on the poll path) and `DashboardPanelStatusRoutes.scala`; wire it in the authenticated tree of `ApiRoutes.scala`. Verify: task 1.2 spec green; schema-drift and schema-conformance checks pass.
- [x] 2.3 Produce the `helio_app` RLS transcript (D5) to `.concertino/scratch/HEL-1786/rls-helio-app.txt`. Verify: labelled statements show 0-row `outputs`/`pipelines` selects for the grantee and the route's 200.

## 3. Frontend

- [x] 3.1 Service `fetchDashboardPanelStatus` + panel-status store (D2/D3) + `deriveDashboardMetaFromStatus`; reset on `onFreshnessReset`. Verify: store/derive jest green.
- [x] 3.2 `DashboardMetaRow` and `DashboardRefreshLine` panel-scope wiring (D4), incl. the reserved-slot rule for grantees. Verify: role jest green; existing owner tests unmodified and green.
- [x] 3.3 `PanelCardBody` panel-scope run-finish refresh via `usePanelStatusRefresh`; confirm and document that the refresh path makes no Output route call; invalidate per-panel provenance/history caches on trigger. Verify: jest green.
- [x] 3.4 `PanelCard` (and every other `useDataInvalid`/`invalidBadge` site) panel-scope badge; `PanelProvenance` no longer forces it off in panel scope. Verify: jest green.
- [x] 3.5 Pull-to-refresh / "Refresh dashboard" control in panel scope triggers an immediate status read; verify it makes no Output/pipeline request.
- [x] 3.6 Update `e2e/hel1773-viewer-grantee-dashboard.spec.ts` and any existing jest assertion that the three features are hidden for grantees; list each with reason in `files-modified.md`.

## 4. Verification

- [x] 4.1 New e2e full file green (desktop + phone pass), viewer and editor, zero `/api/outputs/` and `/api/pipelines/` requests from the grantee page, no 4xx/5xx, no console errors. Save `green-e2e.txt`.
- [x] 4.2 Mutations m1-m3, m4a, m4b, m5-m9 (design D6) each red at its own assertion; transcripts `mutation-m<N>.txt`; code restored after each. Verify: `git diff` clean of mutations.
- [x] 4.3 Full gates: `npm run lint`, `npm run typecheck`, `npm run format:check`, frontend jest (3 workers), `sbt -J-Xmx3g testFull`, the e2e specs whose selectors this change touches (grep `e2e/` for `dashboard-refresh-line`, "Invalid data", "Refresh dashboard", meta-row fact text and run every hit file). Record results.
- [x] 4.4 Update `CLAUDE.md` Key endpoints with the new route (one bullet) and the `dashboard-grantee-access` delta is the spec change. Verify: `openspec validate grantee-dashboard-freshness-signals --type change` passes.
- [x] 4.5 Write `files-modified.md` (every file, planned fixture/assertion changes under their own heading) and commit.
