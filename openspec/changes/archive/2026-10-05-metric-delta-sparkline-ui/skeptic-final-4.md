## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Reviewed HEAD `5d4595cd6bf68fc46ba2a93b9577191634280c2d`. Review base resolved live by `resolve-review-base.sh` (exit 0): `9c247cf6a22858ae0bb5285887995b31de874860`. Evidence ref root: `/home/matt/Development/helio/.concertino/runs/HEL-1275/evidence/openspec/changes/metric-delta-sparkline-ui/screenshots/` (abbreviated `EV/` below).

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/metric-delta-sparkline-ui/HEL-1275`.

**Scope / C1.** `git diff --name-only base...HEAD` has no `ci.yml`, `playwright.config.ts`, `db/migration` or `backend/` path. Diff = `frontend/src/**`, `e2e/**`, change dir. 5d4595cd itself touches only `PanelContent.metricHistory.test.tsx` (+6) and change-dir docs.

**Gates (fresh, by me, worktree, `nice -n 19`).** `npm run lint` exit 0; `npm run typecheck` exit 0; `npm run format:check` exit 0; full jest (`--maxWorkers=3`) `Test Suites: 434 passed` / `Tests: 4524 passed`, exit 0.
`DEV_PORT=6707 BACKEND_PORT=9614 nice -n 19 npx playwright test e2e/hel1275-metric-delta-sparkline.spec.ts --workers=2` → `2 passed (15.8s)` (light, dark). Backdated ids 0fe4229f-0f95-42fb-9dc9-f15d3597653e, 4d420c3e-ae29-4702-b526-b81b459c0613; spec self-cleaned. No sbt run needed (no backend change): no FirstRunRoutesSpec timeout / "Java heap space" observed; HEL-1294 / HEL-1298 not seen.
Servers: pid 7896 cwd `.../HEL-1275/frontend`, pid 7435 cwd `.../HEL-1275/backend` (`/proc/<pid>/cwd`), `assert-phase.sh servers` → `PASS servers`. Reused, not killed.

**Red-first proofs — all in a scratch copy (`scratchpad/fe`, tar copy of `frontend/` with node_modules symlinked; worktree never edited; copy deleted after).** Baseline in the scratch copy has 2 unrelated failures (`controlFitnessDriftGuard`, `outputControlEligibilityDriftGuard` read `../backend/*.scala` by relative path, absent in scratch); every result below is counted net of those, by failing test name. Never-true conditions were written type-safely (`Date.now() < 0 &&`) after a first attempt with literal `false &&` broke compilation via TS narrowing (47 suites "failed to run" — discarded as a measurement artifact, re-run).
1. **Refetch bound** (`useOutputHistory.ts:60` early-return → `void done;`): `PanelContent.metricHistory` → `1 failed, 13 passed` — "…refetches once": `Expected number of calls: 2 / Received number of calls: 6`. Restored → `14 passed`. **RED-first, reproduced independently; matches refetch-bound-proof.md.** The round-3 CR is resolved.
2. Filter guard (`metricHistoryView.ts:155`): 5 HEL-1275 tests red (incl. "a selected dropdown control value builds an op and hides the delta", publisher-side provenance).
3. Compare-mismatch guard (`:113`): 3 red ("…refetches once", "compare None (null) against a cached 7d…", selector test).
4. Baseline-stale identity check (`:136`): 2 red.
5. Sparkline identity filter (`:125`), head guard (`:108`): red (4 failing incl. 2 baseline each → 2 net each).
6. `previous_run` label → "previous run" (`:79`): 1 net red (C4 test).
7. `compareOrNull` omitting the key (`buildOutputConfig.ts:57`): 2 red ("choosing None sends a literal null compare", aggregate-tail carries picker value).
8. Comparison-store unpublish removed (`MetricOutputPanel.tsx:94`): 1 net red (publisher side).
9. **Public page wiring** (`PublicDashboardViewerPage.tsx:134` `historySource` removed): **0 net red** — see non-blocking note 1.

**Acceptance criteria.**
- RTL ▲/▼/flat, available-from, filter-hidden: present in `MetricRenderer.test.tsx` / `PanelContent.metricHistory.test.tsx` / `metricHistoryView.test.ts`, green, and the guards they cover go red under mutation (above).
- Playwright exit-criterion proof: passes in both themes; compare chosen in the editor UI (C5), seeding after `about:blank` (C2), editor-shaped config (C6).
- Light/dark visual check: done live by me (below).

**HEL-918 exit criterion, live, own data.** User afbd19a8-073d-4ee2-9859-b5d8d11bc732; editor-shaped Output `{fieldMapping:{}, aggregation:{value:"amount",agg:"sum"}, format:"integer"}` without compare; run 1 (1075), backdated history row 0be6db7f-9b67-4c44-b272-e48dd757739f by 7d1h, run 2 (1204). Chose "7 days" in the editor (`EV/skeptic-final-4-editor-compare-light.png`); saved config `{'aggregation': {'agg':'sum','value':'amount'}, 'compare':'7d', 'fieldMapping':{}, 'format':'integer'}`. In-app link to Dashboards: the default 3x2 card reads **"1,204 / ▲ 12% vs 7d"** with an inline sparkline (`EV/skeptic-final-4-dashboard-light.png`). One `/api/outputs/:id/history` request shared by both panels.

**Filtered state (real dropdown control, region=west), light and dark.** Filtered card: "604 / Comparison hidden", `title` and `aria-describedby` text "comparison reflects unfiltered data", `tabIndex` 0; unfiltered card unchanged. Filtered panel's provenance has no "Compared with"; unfiltered panel's shows "Compared with 7 days ago · 1,075". `EV/skeptic-final-4-filtered-light.png`, `EV/skeptic-final-4-provenance-light.png`, `EV/skeptic-final-4-filtered-dark.png`.

**Editor → navigate back, no reload, already-open dashboard.** `window.__skR4="alive"` set on the editor page; every hop an in-app click (incl. Settings → dark toggle). After 7d→30d (dark): both cards "1,204 / 30d comparison available from 10/28/2026", marker alive, `navigation` entries = 1 (`EV/skeptic-final-4-compare-30d-dark.png`). After 30d→1d: "▲ 12% vs 1d" (`EV/skeptic-final-4-compare-1d-dark.png`). History requests across the whole session: exactly #623, #679, #717 — still 3 after a 6 s wait. Bounded.

**Public path.** Logged out (`/api/auth/me` 401), opened `/dashboards/:d/panels?token=`. All `/api/` traffic was `/api/dashboards/:d/panels...?token=`; history only via `/api/dashboards/:d/panels/:p/history?token=` (one per panel); zero `/api/outputs` calls. Payload top-level keys `availableFrom, baseline, compare, current, delta, pct, points, sparkline`; point keys `capturedAt, rowCount, summary`; grep `outputId|runId|triggerSource|ownerId|userId|pipelineId` → none; 0 UUIDs in page innerText. Panels show "▲ 12% vs 1d" + sparkline; west filter → "604 / Comparison hidden"; public provenance shows "Compared with 7 days ago · 1,075" on the unfiltered panel, none on the filtered one. `EV/skeptic-final-4-public-dark.png`, `EV/skeptic-final-4-public-light.png`.

**C4 copy.** `git diff base...HEAD -- frontend/src e2e ':!*.test.*' | grep '^+' | grep -i "previous run"` → only the e2e negative assertion and one code comment. Option label is "Previous"; card text never contains the phrase.

**Visual cohesion (DESIGN.md), light + dark.** Delta reuses `.panel-content__metric-trend--up/down/flat`; note matches the trend's mono/micro/muted recipe; sparkline stroke `--app-accent`, sizes from `--space-*`; compact container query keeps the sparkline inline beside the delta at default size without overlapping the footer. Compare `Select` is the shared component in the same section layout as Format (`EV/skeptic-final-4-editor-dark.png`). "Compared with" reuses the provenance heading/value/time classes. Light/dark parity holds. Nothing I would reject on looks.

**Console.** Errors only `GET /api/pipelines/:id/schedule` 404 (pipeline page, untouched), pre-login `/api/auth/me` 401, one `run-events` 502 (SSE through the dev proxy) — none from changed code.

**Gate-defect check.** No claim here rests on mtime/positional ordering; all evidence is command output, request ids, DOM text, or mutation results.

### Verdict: CONFIRM

### Non-blocking notes
1. **Public page wiring is untested.** Removing `historySource={historySource}` from `PublicDashboardViewerPage.tsx:134` leaves jest and the e2e green; the public viewer would then call the authenticated route, fail silently and show no delta. Behaviour is correct live today, and the hook's public branch is unit-tested via `PanelContent`. A one-assertion page-level test (or an e2e public step) would close it. Same class as round 3's `PanelCard` `viewerFilterActive` note (that one is covered by the e2e).
2. At default 3x2 size the "30d comparison available from <date>" note wraps to two lines next to the sparkline and sits close to the footer (`EV/skeptic-final-4-compact-30d-dark.png`). It does not overlap. A shorter compact form ("30d from 10/28") would read cleaner.
3. The e2e editor → back step still does not assert "no reload" (round-3 note). I checked it by hand this round.

**Cleanup.** Deleted by exact id, all 204: share token 39ef74b7-760c-4d82-9a0a-61f9366647b5, dashboard aadcd0f1-0148-4429-a76a-f33a1ba00c29, pipeline c5d252d3-f886-4224-90f9-c084d0cc32ce, source 1f8f7c52-17bc-4cb4-91c7-a851eaa58d3f. Test user afbd19a8-… remains, like every e2e-registered user. Scratch copy removed.
