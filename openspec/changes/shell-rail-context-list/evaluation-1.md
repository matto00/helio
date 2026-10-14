## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c37f3fa16e84f4f112d419c28a3b0e73b1eff26e`. Diff base `e0376657d` (resolved live by `resolve-review-base.sh`).
Evidence directory (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/openspec/changes/shell-rail-context-list/evidence/evaluation-1/`

### Gates (my own runs)

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7138/7138 tests, 598 suites |
| `npm --prefix frontend run build` | PASS |
| `npm run check:schemas` / `:selftest`, `check:tokens` / `:selftest`, `check:scala-quality`, `check:openspec`, `check:spec-structure`, `check:e2e-types`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths` | PASS |
| `sbt testFull` (FULL suite, `HELIO_TEST_JVM_XMX=3g`) | PASS: 8106 succeeded, 0 failed, 4 canceled (pre-existing `HELIO_MEASURE`/perf cancels). The new suites ran: `DashboardFolderRlsSpec` (both role passes), `DashboardFolderRoutesSpec`, `UserPreferencesRoutesSpec`, `PipelineScheduleListRoutesSpec`. Summary: `sbt-testFull-summary.txt` |
| Playwright: every edited spec + `hel1574-shell-rail` + `hel813` + `state-surface-contrast-guard` | PASS: 83/83 (`playwright-edited-specs.log`) |
| Playwright: unedited nav-coupled specs (`hel519`, `hel503`, `hel666`, `hel665`, `hel910`, `hel773`, `focus-presence-guard`, `hel813…regression`) | PASS: 37/37 (`playwright-nav-specs.log`) |
| Full Playwright suite | NOT run (85 files). I ran the minimum set the brief allows, plus the 8 unedited specs that reference the sidebar, nav or bottom nav. |

**RLS in a NOBYPASSRLS session (MISTAKES.md).** I ran this on the dev DB in a single transaction and rolled it back. Two NOSUPERUSER NOBYPASSRLS roles were used: one non-owner and one that owns both tables, so FORCE RLS is exercised. Results:
- With no `app.current_user_id` set, any read errors.
- B sees 0 of A's folders and 0 of A's filings.
- B inserting a folder or a filing owned by A fails with "new row violates row-level security policy".
- B filing into A's folder fails on the composite FK.
- B's UPDATE and DELETE of A's folder each affect 0 rows.
- A re-owning their own folder to B is refused by WITH CHECK.
- After ROLLBACK, no roles or rows are left over.

Artifacts: `rls-proof.txt`, `rls.sql`. **PASS.**

**Live seam probes (curl, real backend).**
- Register returns `preferences`.
- `PATCH /api/users/me/preferences {contextListWidth:320}` returns 200 with the merged preferences.
- Login then returns `contextListWidth: 320`.
- An unknown key returns 400 "Unknown preference field: x".
- `GET /api/pipeline-schedules` returns `{items:[],sources:[]}`.

### Phase 1: Spec Review — FAIL

Most of the work matches. The backend contract, folders, preferences, the schedule list, D12 delete, the Home alias and Usage in the avatar menu are all implemented as designed. The specific divergences:

1. **The `app-shell-rail` "only one active item" intent is broken in the context list.**
   - Reproduced on `/sources/<id>` for a source that is both recently visited and scheduled: two list rows carry `aria-current="page"` and the accent selection wash at once (Recent and Scheduled), on top of the rail's active item.
   - The same happens for any pipeline that is both recent and scheduled.
   - Cause: `ScheduledContextList.tsx` passes `activeId={routeId}` to both `RowList`s.
   - Evidence: `source-detail-1280-dark-double-active.png`.
2. **Recent keeps deleted items, shown as raw UUIDs.**
   - After deleting a pipeline or source from its detail page (D12), the Recent group still lists it, labelled with its bare id (`e59c557d-…`, `d4c29ac2-…`), and the link goes to a missing resource.
   - Cause: `ScheduledContextList.tsx` builds Recent rows only from `recentHistoryStore` (`name: entry.title ?? entry.id`) and never checks them against the loaded collection.
   - Reproduced live on both sections.
3. **Integration with `origin/main` (HEL-1562, merged 2026-10-13 22:21) is unresolved.**
   - `git merge-tree HEAD origin/main` reports content conflicts in `frontend/src/app/CommandBar.tsx`, `frontend/src/theme/elevationTokenGuard.css.test.ts` and `frontend/src/theme/motionTokenGuard.css.test.ts`.
   - HEL-1562 moved the app home from `/` to `/home`, and `/` now serves the static marketing landing page. This branch's `homeAlias.to = "/"` (`frontend/src/shared/chrome/navDestinations.ts`) and the rail logo `Link to="/"` (`AppRail.tsx`) would send signed-in users to the marketing page after merge.
   - `isActiveDestination`'s `destination.to === "/"` special case (`AppRail.tsx`) would also stop matching.
   - The owner ruling "Home opens Dashboards" now means the app home route, not literally `/`.
   - Also confirm that V134 is still free: it is on main today.

### Phase 2: Code Review — FAIL

1. **[mechanical, CONTRIBUTING.md "Imports & Qualifiers"] Inline FQN.** `backend/src/main/scala/com/helio/infrastructure/persistence/auth/UserPreferenceRepository.scala:42` contains `scala.util.Try(JsonParser(jsonStr)…)`. Import `scala.util.Try` at the top of the file. (`check:scala-quality` does not list `scala.util`, so it passes.)
2. **Silent failure.** `backend/src/main/scala/com/helio/api/routes/auth/UserPreferencesRoutes.scala` ~line 434 has `case Failure(_) => complete(500, …)`, which drops the exception without logging it. The sibling `/api/users/me/update` route logs server-side (HEL-311 pattern). Log the exception before answering 500.
3. **Keyboard collapse/expand loses focus (a11y, keyboard support).**
   - Pressing Enter on the separator, or activating "Collapse list", unmounts the focused element, and focus falls to `<body>`.
   - Activating the rail's "Expand list" also leaves focus on `<body>`, because that button unmounts.
   - Verified live: `document.activeElement` was BODY in both directions.
   - Required fix: on collapse, move focus to the rail's "Expand list" button. On expand, move focus to the separator or to the list's "Collapse list" button.
   - Files: `useContextListLayout.ts` / `ContextList.tsx` / `AppRail.tsx`. Add a unit test for each direction.
4. Tests do not cover CR Phase1-1 (a row in both Recent and Scheduled) or Phase1-2 (a deleted item in Recent). Add `ScheduledContextList.test.tsx` cases for both.

Verified fine:
- Edits to other tickets' e2e specs: hel1003, hel1023, hel1275, hel1392, hel1398, hel1444, hel1512 and `support/gridProcessedWidth.ts` are geometry-only. Viewports move by +64px so the grid **container** widths each spec was written for are unchanged (for example 1440−288 = 1504−352 = 1152), and no assertion was loosened. hel1003's ranges shift +8px for 248 vs 240.
- `state-surface-contrast-guard`: the two removed `seeded(sidebar, …)` waits follow directly from AC4 (the list no longer duplicates the table). The context list is still probed per route (4–6 elements sampled on `/`, `/sources`, `/pipelines`, `/pipelines/:id`), and the rail is now in the chrome view (13 sampled). I judge this a preserved intent, not a weakening fixture change.
- `check-schema-drift.mjs`: the comma-safe split is a real parser fix (`Map[String, Double]`). The two SKIP entries are justified, because both bodies are raw-JSON validated.
- `check-tokens.mjs`: the allowlist entry is justified.
- `updateUserPreferences.fulfilled` merge: correct, and covered by `authSlice.test.ts`.
- The D2 merge SQL is a single statement. Isolation is keyed on the session user only, and there is a byte-identical route test.

### Phase 3: UI Review — FAIL

Checked live at 1280, 1100, 820, 768 and 375px, in both themes.

Working as specified:
- Rail: 56px, order Home, Dashboards, Data Sources, Data Pipelines, Connectors, Assistant, then Settings and the avatar at the foot. Every item has a `title` and an aria-label. The rail item alone is accent-washed, and Home is never current. There is exactly one `User menu` trigger at every width.
- The saved width (320) paints on first load with no flash.
- Keyboard resize, Home/End clamps and the pointer drag issue one PATCH (e2e).
- Folders: grouping, counts, Unfiled and move all work.
- Pipeline delete from the header navigates to `/pipelines`.
- Source delete shows the HEL-1258 reference warning, the HEL-989 409 conflict notice (stays on the page) and, on success, navigates to `/sources`.
- Usage is in the owner's avatar menu and not in the rail. The menu opens inside the viewport.

Phone:
- At 768 and 375 there is no rail and no list. The glass bottom nav leads with Home, then the unchanged five tabs, and the command bar keeps the logo and avatar.
- I rendered the 7-tab owner nav at 375 (my eval user set to the owner tier): 7 tabs × 48px, no overlap, `scrollWidth == clientWidth`. This replaces the executor's arithmetic-only proof.
- I could **not** run a side-by-side against main: starting main's backend on the shared dev DB would fail Flyway validation on the already-applied V134 (the MISTAKES.md shared-DB hazard). The phone code path diff is limited to `BottomNav` (+Home), `CommandBar` (unchanged when `useIsPhoneShell()` is true) and an equivalent `App.css` phone override. hel773, hel813 and the focus guard pass at phone widths.

There were no console errors beyond the expected 404 (no schedule) and 409 (refused delete).

Failures (the same as Phase 1-1, 1-2 and Phase 2-3, observed in the running app):
- Two active list rows on a recent-and-scheduled item.
- Deleted items shown as UUIDs in Recent.
- Focus lost on collapse and on expand.

Screenshots: `dash-1280-dark.png`, `dash-1280-light.png`, `pipelines-820-light.png`, `pipeline-detail-1280-light.png`, `source-detail-1280-dark-double-active.png`, `phone-375-dark.png`, `phone-375-light-owner-7tabs.png`, `phone-768-light.png`.

DESIGN §9 vs the B2 board (illustrative only): the rail, the list header with title, the collapse control, folders with disclosure and mono counts, the active-item accent wash, and the darker chrome all correspond. Tabs, the meta row and the status bar are out of scope (HEL-1575/1576).

### Overall: FAIL

### Change Requests
1. **Single active row.** In `frontend/src/app/shell/ScheduledContextList.tsx`, mark `aria-current="page"` and the selection wash on at most one row per list. For example, give `activeId` only to the Scheduled group when the open item is scheduled, and otherwise to Recent. Alternatively, exclude scheduled ids from Recent. Add a unit test where the open item is both recent and scheduled, and assert exactly one `[aria-current="page"]` row.
2. **Recent must not show deleted or unknown items or raw ids.** In `ScheduledContextList.tsx`, filter Recent entries against the loaded `state.pipelines` / `state.sources` collection, which the component already fetches. Take the display name from that collection, and drop entries that are not present once the collection has loaded. Add a unit test: a deleted id in `recentHistoryStore` does not render.
3. **Focus management on collapse and expand.** When the list collapses (separator Enter, separator double-click, or the "Collapse list" button), move focus to the rail's "Expand list" button. When it expands from the rail, move focus to the list's separator or its "Collapse list" button. Add unit tests for both directions.
4. **Rebase onto origin/main (HEL-1562).**
   - Resolve the conflicts in `CommandBar.tsx`, `elevationTokenGuard.css.test.ts` and `motionTokenGuard.css.test.ts`.
   - Repoint `homeAlias.to` and the rail logo link to the app home route HEL-1562 introduced (`/home`, or whatever `sections.ts` now uses for the dashboards path) instead of the marketing `/`.
   - Fix the `destination.to === "/"` branch in `AppRail.tsx`'s `isActiveDestination` to match the new dashboards path.
   - Update DESIGN.md §9/§12, the `nav-section-registry` spec delta ("navigating to `/`") and the `hel1574-shell-rail` e2e accordingly.
   - Re-run jest, the edited e2e specs and `hel1562-landing-page.spec.ts` after the rebase.
5. **`UserPreferenceRepository.scala:42`:** replace the inline `scala.util.Try` with a top-of-file `import scala.util.Try`.
6. **`UserPreferencesRoutes.scala` `Failure(_)` branch:** log the exception server-side (as `/api/users/me/update` does) before completing with 500.

### Non-blocking Suggestions
- Stale comments: `frontend/src/features/dashboards/ui/DashboardList.css` (~lines 103–110 and 494–498) still describe `.context-list` as an `--app-surface` backdrop at `rgb(26,24,22)` after a mechanical `.app-sidebar` to `.context-list` rename. The list now paints `--app-surface-soft`. Also `CommandBar.tsx:207` and `shareDialogContext.tsx:2` still mention `.app-sidebar`.
- Folder toggle on the folder that holds the active dashboard (`DashboardFolderGroup.tsx`): when the folder is saved collapsed, clicking the disclosure re-sends `collapsed: true` and nothing visibly changes. Consider letting the user collapse it anyway, or disabling the toggle with an explanation.
- The Scheduled group's loading state is the text "Loading…" and its empty states are plain `<p>`s. DESIGN §7 prefers the shared skeleton (`SidebarRowsSkeleton`) and `EmptyState` (§7 is [judgment]; the skeptic should rule on it).
- `pipelineScheduleListService.ts` uses `as unknown as` casts. A small typed normalizer would avoid them.
- Add a `check-schema-drift.selftest.mjs` case for `splitTopLevelCommas` (a `Map[String, Double]` param).
- `DashboardFolderService.normalizeName` counts UTF-16 units, while the DB CHECK counts code points via `btrim`. They differ only on astral characters and non-space whitespace.
- At 820px with the default list, the page column is about 516px, so dashboards render the phone stack on tablets. This matches the spec as written; flag it to the owner if unintended.
