## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 08fdbfb844b0f8028f8f19b75ac5c3a98495cceb

### Gates (fresh runs in WORKTREE_PATH, nothing taken from the executor's report)
- `npm run lint`: exit 0. `npm run format:check`: exit 0.
- `npm test`: 393 suites / 4116 tests passed (the `--maxWorkers=3` run also showed a 30-suite / 307-test sub-run, all passed). `npm --prefix frontend run build`: exit 0.
- `cd backend && sbt test`: 5043 succeeded, 0 failed. The known HEL-1215 / `ApiRoutesPipelineRunGuardSpec` SOURCE_FETCH flake did NOT occur, so no re-run was needed.
- `check-scala-quality`, `check-tokens`, `check-schema-drift`, `check-openspec-hygiene`: all clean. No inline FQNs, TODO/FIXME or `any` in the added lines.

### Phase 1: Spec Review — PASS
Issues: none blocking.
- AC 1 (timed live, phone width, both themes), AC 2 (zero Claude), AC 3 (beta sees refine, free does not), AC 4 (a11y): each addressed and verified live or by test (below).
- The `tasks.md` 3.2 box is still unticked. The numbers below belong in it (or in the PR body) once the orchestrator accepts them.
- Executor deviations 1-7 (design.md amendments: stricter numeric rule, `ApiRoutes` test seams, `/dashboards/:id` chrome, injected `applyDashboard`, shared client utils) match the code. They are documented in design.md and are not scope creep.

### Phase 2: Code Review — PASS (with one visible CSS defect, listed under Phase 3 and the Change Request)
- The numeric rule (plain decimal literals only, no thousands separators or currency) is consistent with the `cast` step's `String.toDouble`. The `DateBucketStep.parseNonEpochDate` extraction is shared, not forked.
- The zero-Claude property is structural: `FirstRunDashboardService` has no Claude collaborator. The counting-transport route spec has a positive control.
- Rollback is covered by `FirstRunDashboardServiceRollbackSpec`.
- `AddSourceModal` was refactored to the shared `csvSourceCreate` with its tests green.
- Live cross-tenant probe: `POST /api/first-run/dashboard` with another user's source id returns 404. A non-uuid and an unknown id return 404. A missing `sourceId` returns 400.

### Phase 3: UI Review — FAIL (one objective CSS defect)

**Red baseline (main).** Main code (a `frontend/` dev server from the main checkout, proxied to this worktree's backend) with a fresh free account and an empty workspace shows: "No dashboards yet", then "Build your first dashboard ... in three steps", Connect a data source / Shape it into outputs / Place them on a dashboard. There is no drop zone: `/Drop a/i` found no match. Screenshot: `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/shots1209/eval1209-main-baseline.png`.

**C2 live measurement (this worktree's servers).** I verified `/proc/<pid>/cwd` for both PIDs: the Vite and java processes were the worktree's. Fresh FREE account (`tier=free` confirmed in the DB), empty workspace, `sales.csv` (120 rows: date, region, product, units, revenue) dropped onto the drop zone via a DataTransfer drop event.
- Time from drop to the landed `/dashboards/<id>` with all 3 panels rendered: about 0.5 s. A second run on a beta account took 0.34 s, and a third (no-numeric) 0.29 s. The 60 s budget is met with about 100x margin.
- Interactions: 1 (the drop). By keyboard or touch it is 2 (activate "Choose a file", then pick the file). The budget is 5.
- Stages shown: "Uploading file…", then "Building your dashboard and running the pipeline…".
- Result: table panel (6 visible rows, real data) + "sales over time" chart (monthly, 4 points) + "sales top region" chart (West/East/South/North). Panels are stacked full width, and the URL is `/dashboards/755e268b-…`.
- Limitation: the Playwright toolset has no file-upload handler, so the OS picker path was verified up to the keyboard `Enter` opening the native file chooser (modal state raised). Selecting a file from the chooser is covered only by the jest tests.

**Phone width (390) and themes.** Dashboard at 390 px (light): 3 articles at x=32, w=326, stacked at y=88/668/842 with no overlap, and `scrollWidth == innerWidth` (no horizontal scroll). The drop zone at 390 px in dark renders correctly. Both themes were checked on the dashboard (dark and light at 1440) and on the drop zone (light 1440, dark 390). Token resolution is clean. Screenshots are in `.../scratchpad/shots1209/`.

**Keyboard and a11y.** The drop zone has a real "Choose a file" button, a labelled URL input and a submit button, all with tabIndex 0 (the hidden file input is -1 and aria-hidden). `Shift+Tab` from the URL field reached "Choose a file" with `:focus-visible` true. A live region has `role=status` and `aria-live=polite`, and errors render `role=alert` with a Retry button where the attempt is repeatable.

**Error states (live).**
- Empty (0-byte) CSV: "That CSV has no readable columns…" + Retry.
- Header-only CSV: "The CSV has no data rows" + Retry. The source row it creates is kept so Retry only repeats the build. That is by design.
- Non-csv file: "That doesn't look like a CSV file." with no Retry.
- Malformed link: the browser's native `type=url` validation blocks the submit (its "Please enter a URL" bubble). The custom message path is unreachable for that input.
- `https://example.invalid/data.csv`: "Helio couldn't fetch that link…" + Retry (the backend returned 502).
- 53 MB file: the drop fails fast with "Helio couldn't read that as a CSV. Check the file and try again." + Retry. Cause: `POST /api/data-sources/infer` returns 500 (`EntityStreamSizeException`, limit 8 MiB), not 413. That is a pre-existing infer-route limit; this change does not touch it. See Non-blocking Suggestions.

**No-numeric CSV.** `people.csv` (3 text columns, 30 rows) lands on a dashboard with one table panel and 30 rows rendered, matching the "still a table dashboard" requirement.

**Beta vs free.** Free account (A and B before upgrade): after the first-run landing there is no "Refine with the assistant" button and no "Refine this dashboard" region in the DOM. Beta account (tier set by exact-id SQL on my own test user): the button is present. Clicking it navigates to `/chat` with the composer prefilled with the draft naming the source and pipeline, with ids, and no error.

**Regression check on existing "/" and the new route.** The header controls at `/dashboards/:id` and at `/` are identical (Undo/Redo, appearance, assistant, dashboard actions, user menu, zoom group, breadcrumb). Zoom in (100 to 110%) and the appearance popover both work on `/`. The public viewer route `/dashboards/:dashboardId/panels` is registered outside the protected shell, so `isDashboardViewPath` does not reach it.

**Telemetry.** On one landing, exactly one batch was queued containing `firstrun_file_dropped` (drop), `firstrun_dashboard_created` (panelCount) and `first_dashboard_rendered` once each (verified by wrapping `fetch` on `/api/events`). There is no duplicate `first_dashboard_rendered`. See the pre-existing delivery defect below, which means none of them reach the server.

**Console.** The only console error across all flows is the `POST /api/events` 400 below, plus an ECharts resize warning when the viewport is changed, and one ECharts `containLabel` deprecation log (not from this diff).

**Issues**
1. `FirstRunDropZone.css:118` (`.first-run-drop__button { align-self: flex-start; }`) overrides the drop target's `align-items: center`, so the primary "Choose a file" button is left-aligned beneath a centered icon and "Drop a .csv file here" text. Seen at 1440 light, 390 dark and every width tested (`eval1209-dropzone-light-1440.png`, `eval1209-dropzone-dark-390.png`). The declared intent (a centered target) is contradicted by the cascade, which is an objective defect rather than a taste call.

### Overall: FAIL

### Change Requests
1. `frontend/src/features/onboarding/ui/FirstRunDropZone.css` (rule `.first-run-drop__button`, line 118): `align-self: flex-start` wins over `.first-run-drop__target { align-items: center }` and left-aligns the "Choose a file" primary button inside the centered drop target. Scope the `align-self: flex-start` to the buttons that need it (ghost "Set up step by step" and the "Build from link" secondary, in their own parents), or add `align-self: center` on `.first-run-drop__target .first-run-drop__button`. Re-check both themes at 1440 and 390 and add the screenshots to the handoff.

### Non-blocking Suggestions
- **Pre-existing defect (NOT this ticket; recommend a spinoff).** Every client telemetry batch is rejected. `frontend/src/features/telemetry/track.ts` sends queued objects `{userId, event, properties, occurredAt}`, and the HEL-1208 server (`ProductEventRegistry.validateClientEvent`) rejects the unknown top-level field `userId`: `POST /api/events` returns 400 `{"message":"unknown field(s): userId"}` (verified by direct fetch). The client then treats 400 as "drop", so `first_dashboard_rendered`, `firstrun_file_dropped` and `firstrun_dashboard_created` are never stored. The DB for the fresh test user held only `signup_completed`. The same events sent one at a time without `userId` return 202, so the allow-list itself is fine. `track.ts` is untouched by this diff.
- Oversized files between 8 MiB and 50 MiB hit the infer route's 8 MiB limit, which surfaces as a 500 and the generic "couldn't read that as a CSV" message with a Retry that can never succeed. The 413 message in `firstRunErrors.ts` is therefore not reachable for upload in that range. A client-side size check, or mapping a 5xx at the `reading` stage to a size hint with no Retry, would fix it. A ticket to make the infer route return 413 is also reasonable.
- `DashboardRoute` selects only when the route id changes, so choosing another dashboard in the sidebar while on `/dashboards/:id` keeps the old id in the URL (confirmed live: the URL stayed on "sales" while "second eval" was displayed; a reload shows the old one). This follows design.md decision 7 (selection stays Redux-only), but a shareable or refreshable URL that disagrees with the visible dashboard is a trap worth a follow-up.
- The refine bar appears only when router state carries `firstRun` (it survives a reload, but not a fresh visit). That is consistent with "on the landed dashboard".
- Both top-n and time-series panels render as line charts by default, so "sales top region" is a line over categories. This is a chart-type default, not a defect in this change.

### Cleanup and residue
- Test users: `efc57019-837b-4f09-a12e-3e7e81998344` (free), `070d84e2-42fb-48d5-a60c-a46878cc7944` (set to beta, then deleted), `d30ca61c-f168-46b4-b044-f3fc7cdd3c6e` (beta). All three were deleted by exact id, together with their panels, dashboards, outputs, pipelines, data_sources, rate-window, usage and conversation rows. The post-delete queries for those ids return 0 for users, dashboards, data_sources, the pipeline and product_events.
- Residue left on disk: four CSV upload files in `~/.helio/uploads/csv/` (`ec6bf4f8-d36d-4d3f-8484-67447aad972b.csv`, `40e5e437-1588-4ebf-9042-c0ad9060ae86.csv`, `c7e30bab-7df1-4fdd-bc20-1ddc09047834.csv`, `ca4483d1-952a-4651-a538-365661be1a81.csv`). I did not remove them: deleting under `~` requires the user's "Approved". The matching `data_sources` rows are gone.
- Servers: the worktree backend (java pid 1811309) and frontend (node pid 1814317) were stopped by captured PID. The temporary main-checkout Vite servers (6642 and 6641) were stopped. The main checkout was not modified (`git status` clean). Screenshots were moved out of the repo to `.../scratchpad/shots1209/`.
- Also note: the Playwright browser session is shared and was initially logged in as the owner account. I signed that session out (cookie only) before registering the test users. A stuck native file-chooser modal was recovered by `browser_close`.
