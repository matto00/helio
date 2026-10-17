## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `518ba0d9478892a07c58cf3a9c1a67aa86546993` against the live-resolved base `0d8bd55cf23a8c2a867614d7182d748ab6dde912`
(`resolve-review-base.sh`, after `git fetch`; origin/main is still 0d8bd55cf). Cycle-3 delta: merge `39e966ca8`,
Phase B `00b48cda0`, e2e fixes `bd9089521`, evidence `518ba0d94`. This was a cold respawn, so the ticket, proposal,
design, tasks, specs and workflow-state (C1-C6) were re-read.

### Fresh evidence (my own runs, this head, isolated DB `helio_hel1578`)

- `sbt -J-Xmx3g testFull` (sbtfull.lock, nice 19): `Total number of tests run: 8210`, `succeeded 8210, failed 0, canceled 4`
  (the pre-existing `HELIO_MEASURE` report-only cases), EXIT 0. Evidence:
  `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/.concertino/scratch/HEL-1578/eval3-sbt-full-tail.txt`
- `npm test` (2 workers): root 61 suites / 524 tests; frontend 680 suites / 7962 tests; 0 failed.
- `npm --prefix frontend run build`: exit 0.
- `lint`, `format:check`, `typecheck`, `check:schemas`, `check:tokens`, `check:openspec`, `check:e2e-user-cleanup`,
  `check:e2e-evidence-paths` and `check:scala-quality`: all exit 0.
- **Full Playwright suite** (2 workers, `--trace retain-on-failure`, e2e.lock, DEV_PORT 7010 / BACKEND_PORT 9917,
  `DATABASE_URL` set to `helio_hel1578`): `380 passed, 1 skipped (23.2m)`, EXIT 0. The skipped test is HEL-1575's
  owner-tier switch measurement, which was already skipped before this branch. No HEL-1633 flake appeared. It includes
  all 5 `hel1578-home-changed-dot` tests, all 3 `hel1578-home-page` tests, the new hel1572 Home test, and the `/home`
  cells of both guards. Evidence:
  `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/.concertino/scratch/HEL-1578/eval3-e2e-full.txt`
- Every number the executor claimed in measurements.md "Cycle 3" matched my own runs.

### Phase 1: Spec Review — PASS

Issues: none.

- All five ACs are met. The cycle-3 AC is "the changed dot clears after the user opens it":
  - e2e covers it, and I confirmed it live at 1440px.
  - I also confirmed it live at 375px for the already-selected dashboard (the phone scenario).
- Every task item (2.1, 2.2, 3.3, 3.5) is checked, and each matches the code.
- design.md "Executor notes (Phase B)" records each deviation from D5 against the merged HEL-1575 code:
  - serverClock location
  - the `noteOwnDashboardWrite` signature
  - extracting `hasChangedSince`
  - the `--app-text` token
- **Focus 1: the dot reuses HEL-1575's signal.**
  - Server: `HomeSummaryService` calls `DashboardChangesService.changes` unchanged, with the same 20-id cap,
    empty-id `400` and RLS-scoped omission. Home adds no change-signal SQL.
  - Client: the rule is extracted unchanged into `tabs/changeRule.ts` `hasChangedSince`.
    `selectTabHasChanged` keeps its active-tab exemption and now delegates to that rule.
  - Own writes ride the one `noteOwnDashboardWrite` call (`warmCache.ts:92`).
  - No parallel change tracking exists. Home's private serverClock was deleted in favour of HEL-1575's.
- Constraints:
  - C1–C3 hold.
  - C4: the pipeline queries are unchanged. The change read is HEL-1575's reviewed repository, and the route spec
    proves omission on the non-bypassing pool.
  - C5: `submitPipelineRun` is untouched.
  - C6: merge by merge commit, predicates extended, pins not loosened, isolated DB used, scratch only.

### Phase 2: Code Review — PASS

Issues: none blocking.

- **Focus 2: route integration.**
  - `isDashboardViewPath` is now `p === "/dashboards" || p.startsWith("/dashboards/")` (`sections.ts`).
  - `usesDashboardMetaRow`, `usesDashboardTabBar` (`app/dashboardChrome.ts`) and `hidesBreadcrumbItemName` compose
    it with no source change, so no parallel conditional was added.
  - The rail and BottomNav share one new `isDestinationActive` (`navDestinations.ts`). It replaces AppRail's private
    `isActiveDestination` rather than adding a second rule.
  - `/` still redirects to `/home` (`AppRoutes.tsx:87`). `/home` renders `HomePage`, and `/dashboards` renders `PanelList`.
  - `PanelGrid key={selectedDashboardId}` and `PanelGridSkeleton dashboardId=` are unchanged.
  - Live on `/dashboards/:id`:
    - HEL-1575's tablist renders with the meta row (`app-command-bar--dashboard-meta`).
    - Only the Dashboards rail item has `aria-current`.
    - On `/home`, only Home is current, in both the rail and BottomNav.
- **Focus 3: CSS pins.**
  - `find frontend/src -name '*.css'` gives 147 on this head. `git ls-tree` on 0d8bd55cf gives 146.
  - The only edits to the elevation and motion guard tests are the count (146 -> 147) and a comment.
  - No allowlist or threshold changed in any guard spec (`state-surface-contrast-guard`, `focus-presence-guard`,
    `hel1065`). The diffs there only retarget `/home` to `/dashboards` and add a seeded `/home` cell.
- **Focus 4: migration.**
  - After the fetch, origin/main still ends at V135. The branch's V136 is
    `CREATE INDEX IF NOT EXISTS pipeline_runs_pipeline_started_idx ON pipeline_runs (pipeline_id, started_at DESC)`.
  - `helio_hel1578` flyway_schema_history: 136 success. `pg_indexes` shows the index.
  - The backend log reads "Successfully validated 136 migrations ... Current version 136".
  - The shared `helio` DB is still at V135, so it is not contaminated.
- Tests are meaningful:
  - `changeRule.test.ts` covers the rule's branches.
  - `warmCache.homeStamp.test.ts` fails if the `recordOwnWrite` hook is removed.
  - `useChangedDashboardIds.test.tsx` covers show, clear, own write and X-leaves-Y.
  - The slice test covers the newest-20 id selection.
  - The route spec covers parameter absence, omission and the 400 cases.
- DRY, types and errors: no `any`. A 400 from bad ids short-circuits before any pipeline query.
  `ServiceResponse.run` maps errors at the boundary.

### Phase 3: UI Review — PASS

Live run on 7010/9917 against `helio_hel1578`, with a throwaway user, 3 dashboards, 3 pipelines, a 3h schedule and
seeded runs.

- **New user:** lands on `/home` after registration. The empty states render: the FirstRunDropZone shelf, "No pipeline
  runs yet" with "Go to Data Pipelines", "Nothing needs attention.", and "Nothing is scheduled" with a link.
- **Changed dot:**
  - Setup: I viewed A and switched to B by plain click, then another session edited A.
  - Result: Home shows "Eval A…, changed since your last visit" first, and the sentence reads "One dashboard changed
    since your last visit."
  - Opening A and renaming a panel through the UI (an own write; `ownWriteAt` is stamped after `viewedAt`), while
    another session edited B: A shows no dot and B shows the dot.
  - At 375px, dark: A changed, I opened it from the shelf and returned via the BottomNav Home tab. A's dot cleared and
    B's dot stayed.
- **Focus 5: request volume, live hard load of `/home`.**
  - Requests: `auth/me` x2, one `home-summary?dashboardIds=…`, `dashboards`, `dashboard-changes?ids=…` (HEL-1575 shell),
    `dashboards/<id>/panels` (shell), plus `POST /api/events`, which is 7.
  - There is no `/api/pipelines/<id>/…` request. The e2e printed the identical list.
  - The only spec that loads many pages (twelve pipeline visits) waits out the rate window twice, so it stays under
    120 requests per 60s per user. The other Home specs make about 10 requests per load.
- **Timeline:** 8 marks with one tab stop. ArrowRight moves focus. Labels read like "eval-c-sync, failed, 15:41, source
  returned 0 rows".
- **Needs attention:** the unresolved failure shows Open and Retry. The resolved one shows "Resolved by a later run".
- **Breakpoints:** 1440 / 1100 / 768 / 375 all have scrollWidth equal to the viewport and no element overflows. The
  shelf has 4 / 2 / 2 / 1 columns.
- **Console:** no errors from 7010 during these flows. The only errors were 401s from `auth/me` before sign-in, which
  is existing behavior.
- Evidence:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/.concertino/scratch/HEL-1578/eval3-home-light-1440.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1578/evidence/.concertino/scratch/HEL-1578/eval3-home-dark-375.png`
- Cleanup: the throwaway user was deleted from `helio_hel1578` by exact id and email with `buildUserDeleteSql`. A count
  afterwards found 0 users, 0 of its pipelines and 0 of its dashboards. Servers were left running on 7010/9917 against
  `helio_hel1578`, so the skeptic can reuse them.

### Overall: PASS

### Non-blocking Suggestions

- `e2e/hel1572-appearance-preferences.spec.ts:211`: the new test is titled "no flash", but it only checks the settled
  font of `.home-opening__sentence`, not first paint. The real first-paint probe now runs on `/dashboards`. Either
  rename the test, or add a first-paint check on the Home sentence.
- `homeSummarySlice.ts` `viewedDashboardIds` caps at `MAX_TABS` (the tab cap). The real bound is the server's
  `DashboardChangesService.MaxIds`. Both are 20 today; a named `DASHBOARD_CHANGES_MAX_IDS` would keep them from drifting.
- Not this branch: on `/dashboards/:id`, a plain click on another dashboard in the list keeps the URL on the old id.
  `DashboardRoute` and the list are unchanged from main. The stamp logic handles this correctly (it stamps the
  displayed id).
- Cycle 1–2 suggestions still open:
  - one shared retry on a failed first load
  - split `HomePage.css`
  - `RunDisclosureList` uses `aria-controls` while collapsed
  - Up next has no day cue
  - list the `/home` request set and the HEL-1575/1579 overlap in the PR body
