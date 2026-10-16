## Context

See proposal.md (Why). Ground truth on main at 60086f02b:
- `/home` renders `PanelList` (the selected dashboard; zero dashboards → HEL-1209 `FirstRunDropZone`); `AppRoutes.tsx:112`.
  There is no dashboards-list page. `sections.ts` maps `/home` (end) and `/dashboards/` to Dashboards;
  `isDashboardViewPath` (`sections.ts:158`) gates dashboard chrome in `App.tsx`, `CommandBar.tsx`, `AppRail.tsx`.
  `homeAlias` (`navDestinations.ts`) is a never-current link in `AppRail.tsx` and `BottomNav.tsx`.
- `pipeline_runs` (V24/V28/V63/V126): status `queued|running|succeeded|failed|dry_run`, `started_at`, `completed_at`,
  `error_log`, `trigger_source`; only index `pipeline_id`; RLS owner-only (V35, FORCE). Pruned to 10 real runs per
  pipeline (`PipelineRunRepository.deleteOldRunsInternal`, called from `PipelineRunExecutor:172`,
  `PipelineRunService:245`). Abandoned runs are reaped to `failed` after 600s (HEL-1511).
- `pipeline_schedules` (V62): `enabled`, `kind`, `expression`, `timezone`, `next_run_at`; RLS owner-only.
  `CronSchedule.nextFireTime(kind, expression, timezone, after)` yields one instant.
- Manual run: `POST /api/pipelines/:id/run` → `PipelineRunService.submit` (HEL-505 guards, `429` + `Retry-After`);
  client `pipelineService.runPipeline`, thunk `submitPipelineRun`.
- `GET /api/dashboards` items carry `layout.{lg,md,sm,xs}[{panelId,x,y,w,h}]` and `meta.lastUpdated` (sorted desc).
- Recent visits are client-only (`helio.recentVisits`, ≤10). HEL-1575 (unmerged) adds `GET /api/dashboard-changes`,
  per-tab `lastViewedAt`/`ownWriteAt` in prefs, and a changed-tab predicate (its design D6/D7).
- RLS: `DbContext.withUserContext` runs on the app pool (no BYPASSRLS); `withSystemContext` is privileged.

## Goals / Non-Goals

Goals: the specs in `specs/home-page` and `specs/home-summary-api`; the route move with the smallest shell diff.
Non-goals: see proposal.md. No new visit store; no change to HEL-1575 semantics; no per-pipeline client requests.

## Decisions

**D1 Routes (owner `home-at-home`; constraint C2).** `/home` → new `HomePage`; new `/dashboards` → `PanelList` (same
selection behaviour). `sections.ts`: add a Home entry (`/home`, end, label "Home", `showInNav: false`, picker `other` so
no context list) and repoint the Dashboards nav entry to `/dashboards` (end) keeping the `/dashboards/` prefix entry, so
nav-visible entries stay five. `isDashboardViewPath` becomes `p === "/dashboards" || p.startsWith("/dashboards/")`;
no new parallel predicate. `homeAlias` becomes a current-able destination: rail and BottomNav render it with the
existing active treatment (`aria-current`) when `pathname === "/home"`. Call-site rule for the 38 `"/home"` targets in `frontend/src` (grep, non-test):
a target whose purpose is the dashboard grid (after applying a proposal/patch set, "Back to dashboards", onboarding
"Getting started", the first-run hand-off) → `/dashboards`; "app home" targets (auth redirects, `/`, wordmark, PWA
`start_url`, `PublicOnlyRoute`) stay `/home`. The executor lists every site and its choice in a table in the PR. The same rule applies to the 45 e2e files that
use `/home` as the dashboard grid (including `e2e/support/auth.ts`, `isolateLivePage.ts`): retarget them to
`/dashboards`, keep post-login `/home` assertions only where they assert the landing, and run the full e2e suite.

**D2 Endpoint shape.** `GET /api/home-summary` (top level, like HEL-1575's `/api/dashboard-changes`, so no collision
with `/api/pipelines/:id/...` matchers). New `HomeSummaryRoutes` → `HomeSummaryService` → `HomeSummaryRepository`, all
reads in one `withUserContext` transaction, three set-based queries regardless of pipeline count: (1) real runs with
`started_at >= windowStart` OR status in (`queued`,`running`), joined to `pipelines` for the name (rows older than the
window feed only `attention`, never `runs`); (2) enabled schedules
joined to `pipelines`; (3) per pipeline, the latest succeeded run start after its latest failure (window function over
(1)'s rows, may be computed in Scala from (1)). Ranking (spec "Top eight"), attention, `upcoming` (anchored on the stored
`next_run_at`: first fire = `max(next_run_at, serverNow)`, then iterate `CronSchedule.nextFireTime(prev)`, ≤24 within
6h; this mirrors the scheduler, which fires a due schedule on its next tick; interval schedules are never re-anchored
on `serverNow`, which would invent fires) and `upNext` (first fire per schedule, then soonest 5;
a pipeline with one schedule contributes its next fire) are computed in the service as pure functions with unit tests.
Constants in one object: `WindowHours=24`, `HorizonHours=6`, `MaxPipelines=8`, `MaxRunsPerPipeline=150`,
`MaxUpcoming=24`, `UpNext=5`, `StuckAfter=15min`, `MissedAfter=10min`, `ErrorLogMax=500`.
Contract: `schemas/home/home-summary-response.schema.json`, protocol case classes in `api/protocols/home/`, drift check.
No OpenAPI yaml exists (verified); the JSON Schema + spec are the contract, as for every endpoint here.

**D3 Scoping and RLS proof (C3, C4; skeptic r3).** Queries (1) and (2) carry an explicit `pipelines.owner_id =
caller` filter, as `listByPipeline` and `PipelineScheduleRepository.scala:63` do (CONTRIBUTING.md ACL triad): the
dev/CI app role is a superuser and bypasses RLS (MISTAKES.md), so RLS alone would leak every user's pipelines into
dev Home, e2e and screenshots. Because the explicit filter would mask RLS, the RLS proof is separate: on a
non-bypassing session, raw `pipeline_runs`/`pipeline_schedules` selects with no owner predicate return none of A's
rows for B, first asserting `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user` is false/false in that
session (the `helio_app_test` precedent); the same
selects via `withSystemContext` return A's rows (proving RLS, not data absence, filters them). Separately, on a
bypassing connection, the summary for B excludes A's pipelines and that test fails with the owner filter removed. The
D4 EXPLAIN runs under a non-bypassing role with `app.current_user_id` set: the test harness's `helio_app_test` role
(seeded there), or on the dev DB via `SET ROLE` to a NOBYPASSRLS role the executor creates and drops; recorded which. A route test with
`TwoUserRlsApiFixture` covers `401` and cross-user invisibility.

**D4 Retention (owner `keep-24h`).** `deleteOldRunsInternal` keeps ids in (10 newest) ∪ (started ≥ now−24h), then caps
at the 300 newest; dry-run retention untouched; all three call sites (`PipelineRunExecutor:172`, `PipelineRunService:245`,
`SparkJobSubmitter:72`) unchanged (owner-scoped `deleteOldRuns` still gates on
ownership first). Red first: a repository test with 40 runs over 20h fails on main (10 kept) before the change.
V136 adds `CREATE INDEX pipeline_runs_pipeline_started_idx ON pipeline_runs (pipeline_id, started_at DESC)` for the
window query and the prune. V136 is the next free version (HEL-1579 claims V135); re-check before merge.
Measured: `EXPLAIN ANALYZE` of query (1) for one user with 50 pipelines × 300 runs, recorded in `measurements.md`
(target < 50ms on the dev DB; seed and remove by exact id).

**D5 Changed dot (owner `build-now-wire-after-1575`, ruling `data-or-edit`; skeptic r1 CR1, r2 CR1-2).** The
palette's recent entries are not usable as "last seen": `recentVisitsListeners.ts` records on every selection change
(incl. `dashboardsSlice`'s boot auto-select), `recordVisit` (`recentHistoryStore.ts:145-151`) rebuilds an entry from
scratch, `visitedAt` is client time, and the ten-entry cap is shared with sources/pipelines. So the recent-visit module
gains a second, keyed store beside the list (`helio.dashboardSeen`: `{[dashboardId]: {viewedAt?, ownWriteAt?}}`, server
time), which the palette never rewrites; it is pruned by the existing prune listener to dashboards that still exist,
and capped at 500 entries (oldest dropped). The palette list and its behaviour are unchanged. Clock: HEL-1575's
`serverClock` once merged; in Phase A an offset from the summary's `serverNow` (0 until measured, like HEL-1575).
- Phase A: `viewedAt` is written only for the dashboard actually displayed (skeptic r4): on `/dashboards/:id` the
  route id once `DashboardRoute` has applied it, on `/dashboards` the selected id once its panels have rendered for
  that id (an effect keyed on the displayed id, not on mount, since `DashboardRoute`'s selection effect runs after
  `PanelList`'s); again on switching and on unmount/`pagehide`. Home load, boot auto-select and tab restore write none.
  Shelf cards link to `/dashboards/:id`.
- Phase B (after HEL-1575 merges and origin/main is merged in): `ownWriteAt` is written from HEL-1575's
  `noteOwnDashboardWrite` path for every own content write, tab or no tab (one hook on that same call, not a second
  enumeration of write paths). `lastSeen = seen.viewedAt` and `ownWrite = seen.ownWriteAt` only: HEL-1575's tab
  `lastViewedAt` is not used, because its leave stamp (`dashboardTabsListeners.ts:99-104`) marks restored tabs that were
  never displayed, which would clear a dot for a dashboard the user never opened. The dot is HEL-1575's pure comparison
  (`contentUpdatedAt > max(lastSeen, ownWrite)` or `dataUpdatedAt > lastSeen`; no `lastSeen` → no dot), taken by
  extracting it from `selectTabHasChanged` (without its active-tab exemption) into a shared module, never
  re-implemented. The summary passes `dashboardIds` = ids with a `viewedAt` (≤20, newest first); the server reuses
  HEL-1575's repository query for `dashboardChanges`. An own unmount-flush ack lands after the leave stamp but sets
  `ownWriteAt`, so it never marks (edit X, switch to Y, open Home).
- HEL-1575's own shell request to `/api/dashboard-changes`, if any, is shell traffic; the PR lists the observed
  request set on `/home`. Stamps are per device except the server-side tab stamps; stated in the PR. The executor
  re-reads the merged HEL-1575 code before wiring and records any deviation here. Phase A ships no dots, shelf ordered
  by `meta.lastUpdated`.

**D2a In-flight flag.** Each attention item carries `inFlight: boolean` (its pipeline has a `queued`/`running` run),
computed server-side from query (1), so "Running now" works for pipelines outside the top 8.

**D6 Frontend structure.** `features/home/` with `services/homeService.ts` (`fetchHomeSummary`), a small slice
`homeSummarySlice` (status, data, error; `createAsyncThunk`), and presentational components: `HomeOpeningLine`,
`DashboardShelf` + `LayoutThumbnail` (scales `layout.lg`, falling back to md/sm/xs, to a 12-column box grid; empty
layout → "No panels yet"), `RunTimeline` (+ `TimelineMark`, legend), `NeedsAttention`, `UpNext`. Pure helpers with unit
tests: `buildSummarySentence`, `shelfOrder`, `timelineScale` (time → %), `hourTicks`. Retry (unresolved failed) and Run now (missed) call the existing `runToUpdate` (C5; same guarded `POST /run`) and refetch the summary once
on success; `429` copy uses `Retry-After`. Stuck items get Open only: a heartbeating run may still be live and manual
submits have no per-pipeline in-flight guard; for the same reason a failed/missed item with `inFlight` shows "Running now" instead of Retry/Run now. Zero dashboards → the shelf area renders the existing `FirstRunDropZone`
(HEL-1209) unchanged, so the new-user flow keeps its one step; its `onStepByStep` dispatches `reopenOnboarding()` and
navigates to `/dashboards` with `state: {stepByStep: true}`, which `PanelList` reads to initialise its `stepByStep`. The summary refetches
on `visibilitychange` → visible; a 60s client tick moves the "now" line without a request.

**D7 Timeline interaction.** A composite with roving `tabindex` (one tab stop): Left/Right within a row, Up/Down to the
nearest-in-time mark of the adjacent row, Home/End to row ends. Each mark (run or fire) is a `<button>` with `aria-label` like "orders-sync, failed, 03:10, source returned 0 rows". A
tooltip (existing shared tooltip/popover if one fits, §6) shows status, start, duration, rows, trigger, error. Shapes
per spec; colours from success/danger/muted intent tokens; the "now" line uses a neutral strong token, not the accent
(§0). Marks closer than their width overlap; `runsOmitted` renders "+N earlier"; when a pipeline holds 300 runs (the
retention cap) and the oldest starts inside the window, the row says where its history starts. Coarse pointer (`(pointer: coarse)`, any width,
per DESIGN.md §3's 44px touch floor) or phone shell (`useIsPhoneShell()`): each pipeline is
one ≥44px disclosure button ("orders-sync, 12 runs, 1 failed, next 14:00") over a non-interactive mark strip; it
expands a ≥44px-row list of runs and fires (shape + status text, time, error, link). Layout: 1280 shelf 4 columns,
timeline 2/3 beside attention + up next; 820/768 shelf 2×2, sections stacked; 375 shelf one column (owner answer `four-changed-first`), phone
timeline. The page has no display `<h1>` (§9: the top bar carries the "Home" label); the page root is a
`<section aria-label="Home">` inside the shell's `<main>` (no shell change); the opening sentence is a paragraph.

## Risks / Trade-offs

- [HEL-1575 slips] → Phase A is complete and reviewable; the orchestrator re-escalates before the final gate.
- [Route move collides with HEL-1575/1579 edits] → minimal diffs to shared predicates; merge origin/main before
  Phase B and re-run gates.
- [Stamps are per device: tab stamps are not used, D5] → viewing a dashboard on another device does not clear the dot
  here; stated in the PR.
- [Runs of shared pipelines are not shown] → owner-only RLS; stated as a non-goal.
- [More rows kept] → ≤300 per pipeline, bounded by the run rate limit; index added.

## Planner Notes

Self-approved: endpoint path and field names; 6h future horizon (the board shows scheduled marks after "now");
mark shapes; roving tabindex; no context list on Home (board shows none); "now" line not accent; `Open` goes to
`/pipelines/:id` (no run deep link exists); summary sentence wording "since your last visit" rather than "overnight";
resolved failures stay listed but after unresolved ones; the drop zone inside Home's empty shelf (skeptic r1 item 7,
following the existing first-run spec rather than adding a click; the PR asks the owner to confirm with sign-in landing). Owner answers C1 (2026-10-15) fix sign-in landing, shelf,
top-N, stalled, retention and sequencing.

## Executor notes (Phase A) — deviations from the plan, grounded in the code

1. **`next_run_at` null is projected forward from now (D2).** The plan anchored `upcoming`/`upNext` on the stored
   `next_run_at` only. A schedule saved moments ago has a null `next_run_at` until the scheduler's next tick
   (`PipelineSchedulerService.recomputeOnly`, which computes forward from now without firing), and a real e2e run showed
   it hiding a just-created schedule from Home. `HomeSummaryBuilder.firstFire` now mirrors the scheduler: null means
   the next fire after now. Stored, due and not-due cases are exactly as specified. No spec scenario changes (none covers
   null).
2. **Existing retention tests asserted keep-10 on runs started "now".** Two backend specs
   (`FireTimeRunConfigGateSpec` "keep at most 10 runs over 12 fires", `PipelineRunEditorPersistenceSpec` "keep exactly
   10 run rows after 11 editor runs") and two cases in `PipelineRunRepositorySpec` encoded the old rule; under keep-24h
   runs started inside the window are spared. They now assert the new rule (12 and 11 kept), and the pruning path for
   editors is still proven on 12 runs from 3 days ago. `deleteOldRuns` with `keepN` is unchanged for runs older than 24h.
3. **`runToUpdate` result gained two optional fields** (`rejected`, `retryAfterSeconds`), additive, so Home can word the
   429 as "The run was not started: too many runs right now. Try again in N seconds." (spec 429 scenario) without
   parsing a message. `submitPipelineRun` is untouched (C5).
4. **Changed-dot token.** HEL-1575's marker token is not on main. Phase A has no dots (`useChangedDashboardIds` returns
   the empty set), and the shelf's dot CSS uses `--app-warning` (an intent token, never the accent, DESIGN.md §0.3). Phase B
   re-checks it against HEL-1575's marker and records any difference here.
5. **`waitForShell` in `e2e/support/auth.ts`** now opens `/dashboards` first: sign-in lands on Home, which has no
   dashboards list or "Add dashboard" button. All 21 users keep their meaning (the shell they wait for is the dashboard
   view's).
6. **Single in-flight summary request.** The page dispatches `loadHomeSummary` on mount and on `visibilitychange`; React
   StrictMode (dev) double-runs the mount effect, which the e2e network log showed as two requests. The thunk's
   `condition` skips a dispatch while one is in flight (`homeSummary.inFlight`).
7. **Attention `at`** for a failed item is the failed run's start (the same instant as its timeline mark); `reason` is
   null for `stuck` and `missed` (the client words those from `at`).
8. **Dev DB vs test DB for EXPLAIN (skeptic note 4):** the number in `measurements.md` is from the embedded test
   Postgres under `helio_app_test`, not the dev DB.
9. **Pending Retry (skeptic note 5):** `POST /api/pipelines/:id/run` returns the `RunResult` after the run finishes, so
   a Retry stays pending for the whole run. The button is disabled with "Running…" and a `role="status"` note reads "A run
   is in progress. This can take a while, and the list updates when it finishes."; the summary refetches once after the
   response. Observed in `e2e/hel1578-home-page.spec.ts`.
10. **State-surface and focus-presence guards** (`e2e/state-surface-contrast-guard.spec.ts`,
    `e2e/focus-presence-guard.spec.ts`) were retargeted from `/home` to `/dashboards` and keep measuring the dashboard
    view. They do not yet cover the new Home page itself; adding it as a route key is a follow-up candidate.

## Executor notes (Phase B, after merging origin/main at 0d8bd55cf)

Re-read of the MERGED HEL-1575 code, and every place it differs from what D5 assumed:

1. **`serverClock` is `features/dashboards/tabs/serverClock.ts`** (module offset, `setServerOffsetMs`/`serverNowMs`),
   set only when change signals arrive. Home's own offset module (Phase A) was deleted; `loadHomeSummary` now sets
   the same offset from the summary's `serverNow`, and view stamps use `serverNowMs()`. One clock, two measurers.
2. **`noteOwnDashboardWrite(dispatch, userId, dashboardId, listLoaded)`** (`tabs/warm/warmCache.ts`) is the one hook:
   it already computes `ownWriteAt = serverNowMs() + 2s slack`, so the Home stamp (`dashboardSeenStore.recordOwnWrite`)
   carries the same slack and is written for every own content write, tab or no tab. It is called from the
   `OWN_WRITE_SOURCES` table in `warmListeners.ts`; no second enumeration of write paths was added.
3. **`selectTabHasChanged` takes a tab id and reads tab state** (`dashboardTabsSelectors.ts`), not a pure
   `(signal, lastSeen, ownWrite)` function. The comparison was extracted unchanged into `tabs/changeRule.ts`
   `hasChangedSince`; the selector keeps its active-tab exemption and calls it, Home calls it with
   `helio.dashboardSeen` stamps. Its own test file (`changeRule.test.ts`) covers the rule; the existing selector tests
   still pass unchanged.
4. **Repository and service reused whole.** `DashboardChangesService.changes(rawIds, user)` (its 20-id cap and
   empty-id `400`) and `DashboardChangesRepository` (RLS-scoped, omits unreadable ids) are called by
   `HomeSummaryService`; Home adds no change-signal SQL. The change read runs in its own `withUserContext`
   transaction, before the pipeline reads, so a bad `dashboardIds` costs no pipeline query. Query count stays
   independent of the number of pipelines and dashboards.
5. **The dot token is `--app-text`**, not `--app-warning`: HEL-1575's `.dashboard-tab__dot` uses the neutral foreground
   deliberately (an intent colour can equal a user's accent preset). The shelf dot now uses the same token.
6. **Shell requests on `/home`.** HEL-1575's shell makes `GET /api/dashboard-changes?ids=` for the saved tabs (its
   refresh triggers); Home does not call it. The measured full list is in `measurements.md`.
7. **Saved tabs on Home.** `useDashboardViewStamp` (Phase A) is unchanged by the tabs; it stamps only the displayed
   dashboard. A restored tab that was never displayed has a tab `lastViewedAt` but no Home stamp, so the two markers can
   disagree, as C5 states.
8. **Merge resolution (C2/C6).** `isDashboardViewPath` now returns true for `/dashboards` and `/dashboards/*`;
   `usesDashboardMetaRow`, `usesDashboardTabBar`, `hidesBreadcrumbItemName` and `tabsBrowserTriggers` compose it and
   needed no source change (their tests, written for `/home`, moved to `/dashboards` and gained a Home-is-false case).
   `store.ts` keeps both `homeSummary` and `dashboardTabs`. The CSS pin tests were recounted with `find`: main is 146,
   `HomePage.css` makes 147 (never loosened). `DESIGN.md` keeps main's Edit layout / gutter / `⌘K` bullets and the Home
   bullet. `e2e/hel813*`, `hel909` and `state-surface-contrast-guard` took main's new content with `/home` goto's
   retargeted to `/dashboards`.
