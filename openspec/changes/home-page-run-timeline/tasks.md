## Standing Constraints

- [C1] Owner answers 2026-10-15: home-at-home, four-changed-first, top-8-failures-pinned, stuck-or-missed, keep-24h, build-now-wire-after-1575
- [C2] Route/shell diff minimal: extend shared predicates (isDashboardViewPath, sections registry), no parallel conditionals; note HEL-1575/HEL-1579 overlap in the PR body
- [C3] Retention keep-24h proven red-first; pipeline_runs RLS/owner scoping unchanged and proven in a non-BYPASSRLS session
- [C5] Retry/Run now use `runToUpdate` (keeps 429 + Retry-After), never `submitPipelineRun`, whose rejection shape stays unchanged; the displayed id on `/dashboards/:id` is the selected id once it matches the route; the PR names dropping tab `lastViewedAt` as a deviation from the `build-now-wire-after-1575` option text (tab marker and Home dot can disagree); a pending Retry stays readable for a long run
- [C6] Owner `park-until-1575` answered; HEL-1575 merged 0d8bd55cf. Integrate main by merge; extend `isDashboardViewPath`/`usesDashboardMetaRow`/`hidesBreadcrumbItemName`, never parallel conditionals; never loosen CSS pins; gates on isolated DB `helio_hel1578`; scratch only in `.concertino/scratch/HEL-1578`; full e2e on the final head
- [C4] Every summary query carries an explicit `pipelines.owner_id = caller` filter (dev/CI app role is superuser, RLS bypassed); RLS proven separately by raw selects without an owner predicate on a non-bypassing role

## 1. Phase A

### Backend

- [x] 1.1 Write the failing retention test (40 runs over 20h → 10 kept on main), record the red run, then change `deleteOldRunsInternal` per D4 and verify green plus the 15-old-runs and 350-run cap scenarios
- [x] 1.2 Add `V136__pipeline_runs_pipeline_started_idx.sql` (re-check the next free version first) and verify Flyway applies it on a fresh test DB
- [x] 1.3 Add `HomeSummaryRepository` set-based queries in one `withUserContext` transaction (D2) and verify with a repository spec
- [x] 1.4 Add `HomeSummaryService` pure ranking/attention/upcoming/upNext functions with constants (D2, upcoming anchored on `next_run_at`) and verify unit tests for every home-summary-api scenario with fixture clocks off the hour
- [x] 1.5 Add protocol case classes, `schemas/home/home-summary-response.schema.json`, `HomeSummaryRoutes` mounted in `ApiRoutes.scala`; verify the schema-drift check and a route test that validates a real response against the schema
- [x] 1.6 Record `EXPLAIN ANALYZE` (50 pipelines × 300 runs) under a non-bypassing role with `app.current_user_id` set (where: per D3) in `measurements.md`; verify < 50ms and seeded rows removed by exact id

### Frontend

- [x] 1.7 Move the dashboard view to `/dashboards`, add Home to `sections.ts`, update `isDashboardViewPath`, `homeAlias`, `AppRail.tsx`, `BottomNav.tsx` (D1); verify the rail/bottom-nav tests for one active item on `/home` and `/dashboards`
- [x] 1.8 Retarget every `"/home"` call site in `frontend/src` per the D1 rule and verify with a grep table (site, purpose, target) in `files-modified.md`
- [x] 1.8a Retarget the e2e suite's dashboard-grid uses of `/home` (incl. `e2e/support/auth.ts`, `isolateLivePage.ts`) per D1 and verify by grep table
- [x] 1.9 Add `features/home` service, slice and thunk (D6); verify slice tests
- [x] 1.9a Add the keyed `helio.dashboardSeen` store and the `viewedAt` stamp for the displayed dashboard only (D5); verify tests: Home load/auto-select keep a stored stamp, recordVisit does not erase it, pipeline visits do not evict it, opening X from Home while Y is selected stamps X only, an already-selected dashboard is stamped when displayed
- [x] 1.10 Build `HomeOpeningLine`, `DashboardShelf`, `LayoutThumbnail` with helper unit tests (`buildSummarySentence`, `shelfOrder`)
- [x] 1.11 Build `RunTimeline`/`TimelineMark` with roving tabindex, labels, tooltip, shapes and legend (D7); verify keyboard and label tests
- [x] 1.11a Build the row disclosure list used on coarse pointers and the phone shell (D7); verify tests at 820px coarse and 375px incl. a failed run's error
- [x] 1.12 Build `NeedsAttention` (Open; Retry for unresolved failed, Run now for missed, none for stuck/resolved, "Running now" when a run is in flight; 429 copy) and `UpNext`; verify tests incl. a mocked 429
- [x] 1.13 Build loading, error and new-user empty states (shelf renders the existing `FirstRunDropZone`; step-by-step opens `/dashboards` with the checklist); verify tests
- [x] 1.14 Update DESIGN.md §9 and §12 "Home tab" (Home is a real page, current on `/home`, no context list) and verify `npm run lint`/`typecheck`

## 2. Phase B (only after HEL-1575 is on origin/main and merged into this branch)

### Backend

- [x] 2.1 Accept `dashboardIds` and fill `dashboardChanges` by reusing HEL-1575's change-signal query (D5); verify 400/omission/RLS tests

### Frontend

- [x] 2.2 Hook `ownWriteAt` onto HEL-1575's `noteOwnDashboardWrite`, wire the dot with HEL-1575's predicate (D5) and changed-first ordering; verify dot-clears, own-edit-then-switch and stamp-eviction tests, record deviations in design.md

## 3. Tests

### Tests

- [x] 3.1 Backend scoping specs per D3: (a) non-bypassing role (rolbypassrls/rolsuper false asserted), raw `pipeline_runs`/`pipeline_schedules` selects with no owner predicate return none of A's rows for B, `withSystemContext` returns them; (b) on a bypassing connection the summary for B excludes A's pipelines, and fails if the owner filter is removed
- [x] 3.2 Playwright e2e (≤2 workers): new user lands on `/home` with empty states; seeded user: network log shows one `/api/home-summary` and no per-pipeline request; failed run under Needs attention; Retry posts one run; wait for `document.fonts.ready` before layout assertions
- [x] 3.3 Playwright e2e (Phase B): dot shows after another user's edit or new data, clears after opening the dashboard, does not show after an own edit followed by a plain-click switch, and with two saved tabs [Y changed, X] opening X from Home leaves Y's dot
- [x] 3.4 Screenshots of the running app at 1280/820/768/375 (shelf one column at 375) in light and dark, populated and new-user, saved under the change dir
- [x] 3.5 Full gates: `sbt testFull` (foreground shards), `npm test` (≤3 jest workers), the full Playwright e2e suite (≤2 workers), lint, typecheck, format, schema drift, openspec validate
