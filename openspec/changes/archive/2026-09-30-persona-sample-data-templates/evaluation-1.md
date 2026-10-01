## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 25ec96b58a4ea77c14fafb68005a960d1e0b6c06 against base 0cbab40e (live-resolved).

### Phase 1: Spec Review — PASS
- Red-first on main: `git grep` on 0cbab40e for `first-run/template|FirstRunTemplateChips|PersonaTemplates|buildTemplate` returns nothing: no route, no chips, no registry; PersonaTemplateRoutesSpec (ownership, cross-user 404, no system-user rows) does not exist there. Here it passes (full sbt run).
- Every AC addressed: chips on all four personas, 1 click after signup (<=5 interactions); ownership tested (PersonaTemplateRoutesSpec: owner_id == caller on data_sources/pipelines/outputs/dashboards/panels, B gets 404/absent, edit+delete by owner); dataset validation in CI (PersonaTemplatesSpec); RolledUpTemplateSlugs populated; DemoData fate stated (retired).
- C1 (real slug + mutation), C2 (full-width lg, verified at phone), C3 (CLAUDE.md, backend/README, dead count() removed), C4 (rollback spec for pipeline-fail and dashboard-fail) all honored.
- No migration added (V114 untouched).
- DemoData removal complete: only residual mentions are historical comments (DbContext.scala:29,60; OutputRepository.scala:80; V38/V94 SQL comments; PipelineStep.scala:51; docs/cloud-dev-setup.md troubleshooting row; archived superpowers spec). No code references remain.

### Phase 2: Code Review — PASS
Gates run fresh in WORKTREE_PATH (nice -n 19):
- `npm run lint` clean; `npm run format:check` clean; root `npm test` 307/307; `frontend` jest 396 suites / 4135 tests pass; `npm --prefix frontend run build` OK.
- `sbt test`: 5088 succeeded, 1 failed = DatasetWriteAutoRunEndToEndSpec "reports the observed elapsed time" (996ms vs >=1000ms timing assertion; run concurrently with my jest). Unrelated to this diff (HEL-1093 latency probe); re-run in isolation: 4/4 pass. Not a regression.
- chartType/columnOrder workaround is real: `FirstRunPlanner.dashboardProposal(.., explicitChartTypes=true)` stamps chartType on the PANEL; `applyChartTypes` patches `appearance.chart.chartType` post-apply (best-effort); table output config carries `columnOrder`. PersonaTemplateRoutesSpec asserts both from DB (panel appearance chartType, outputs.config.columnOrder). Live: tables show columns in declared order, line/bar charts as specified.
- Rule-planner path unchanged: output names (`<source> table`, `over time`, `top <cat>`), "double" casts, `explicitChartTypes` default false, `pinColumnOrder` default false; HEL-1209 FirstRunRoutesSpec still green on shared fixture.
- One apply path (`applyPlan`), source cleanup on failure incl. recoverWith; no Claude client in constructor, not tier-gated.
- Wire fixture mutation (done by me, reverted, tree clean): changing the fixture's template slug to "sales-overview" FAILS frontend `track.wireContract.test.ts` and FAILS Scala `ProductEventRegistrySpec` ("carry a real persona template slug").

### Phase 3: UI Review — PASS
Servers on 6642/9549 verified to be this worktree (process cwd = HEL-1210/backend, HEL-1210/frontend; `POST /api/first-run/template` unauthenticated -> 401, not 404).
Four FRESH accounts registered through the UI (all tier=free in DB): eval1210-{streamer,founder,ops,finance}@helio.test. Each: chip click -> landed on `/dashboards/<id>` titled "<Persona> ... (sample)" with 3 panels (table + line + bar) of real data; panel count 3 and panelCount telemetry 3.
- Streamer: desktop dark + desktop light + phone light + phone dark. Founder: chips phone dark, dashboard phone dark, desktop light. Ops: chips desktop light, dashboard desktop light, phone dark. Finance: phone dark (desktop light captured). Both themes and both widths seen across the personas; chips surface seen in light (desktop) and dark (phone).
- Phone (390px): panels full-width (326px), stacked with distinct tops (e.g. 88/668/842), no overlap; charts render at 162px height. Desktop 1440: full-width stacked rows.
- Keyboard: focused the Founder chip and pressed Enter -> built and navigated. Chips are real `<button>`s in `role=group aria-labelledby`; `:focus-visible` uses `--app-focus-ring`; disabled while working. Live region (`role=status aria-live=polite`) shows TEMPLATE_STAGE_LABEL; errors via existing InlineError alert path; Jest covers a11y roles, live region, error alert, retry.
- DESIGN.md: chip CSS uses only --space-*/--text-*/--app-* tokens, opaque surface, reuses shared InlineError/Spinner. Visually cohesive with the drop zone in both themes.
- Console: only expected 401s on unauthenticated routes. One burst of 429s occurred when I reloaded the dashboard repeatedly in quick succession (general /api rate limit, my test behavior); cleared on retry; not caused by this change.
- Screenshots (not at repo root): /home/matt/Development/helio/.playwright-mcp/{streamer,founder,ops,finance}-*.png (inside this worktree's .playwright-mcp, untracked; not persisted via persist-evidence since none is cited as sole load-bearing evidence beyond the DB measurements below).

Telemetry proven live (DB):
- product_events for each fresh user: signup_completed, `firstrun_template_chosen {"template":"<slug>"}` (streamer/founder/ops/finance), firstrun_dashboard_created {panelCount:3}, first_dashboard_rendered.
- product_event_property_daily: day 2026-10-01, firstrun_template_chosen/template = ops, streamer, finance, founder, count 1 each. No `other` bucket row.

Cleanup claims:
- `users` with email like 'live-%@helio.test': 0 (executor's claim of deletion confirmed).
- Orphan CSVs under ~/.helio/uploads/csv (files with no referencing data_sources path): 32 now, not 20 (includes 4 from my accounts, whose sources I deleted with the users; the executor's 20 are not individually identifiable without a baseline). Left untouched as instructed. Note: this means deleting a CSV source leaves its file; existing behavior, not introduced here, but the template rollback path will leave orphan files on failure like any source delete.
- My test users: deleted by exact id (dfe46429-8fce-4084-85bc-d1666dbca6fb, 3c0e5f22-8ba6-42fe-a5e6-e1248a06a68e, 758172aa-6322-45d4-bc65-9d3795eb96c5, 8bda26bd-ff9a-404f-99c3-25012fb817ec) with their sessions, dashboards, panels, pipelines, outputs, data_sources, product_events rows (users->owner_id/user_id tables). Residue I could not remove: 32 orphaned `pipeline_steps` rows (their pipelines are gone; a further cleanup DELETE was blocked by the permission classifier, so I stopped) and 4 aggregate rows in product_event_property_daily (day 2026-10-01). Dev DB only; flagged for the human/driver.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `backend/src/main/resources/templates/README.md:24` names the CI test `PersonaTemplateDatasetSpec`, which does not exist; the dataset checks live in `PersonaTemplatesSpec`. Fix the name.
- Stale "DemoData" mentions in comments (DbContext.scala:29,60; OutputRepository.scala:80) now refer to a deleted class; reword when next touched.
- Founder sample rows run to 2026-12 (future-dated relative to today); cosmetic.
- Dev-DB residue noted above (32 orphan pipeline_steps, 4 rollup rows, 32 orphan CSVs) is for the human to clear.
