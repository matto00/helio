## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD e0376657d1940b2c084abc65fdece74a7001283e (planning artifacts are uncommitted in the change dir).
I treated the owner rulings in ticket.md as binding and did not re-argue them. The open escalation about the phone
Home tab replacing the Dashboards tab is not a factor in this verdict.

### What I verified (with evidence)

- **V134 is free.** On origin/main (fetched) the newest migration is `V133__pipeline_run_rate_window_user_cascade.sql`.
  No remote branch, local branch or worktree has a V134-V139 file.
- **ProtectedRoute waits for `/api/auth/me` on reload.** `features/auth/ui/ProtectedRoute.tsx` shows a spinner while
  `status` is `idle`/`loading`. `rehydrateAuth` (authSlice.ts:59-68) calls `getMeRequest` and then `setAuth`. The
  no-flash claim holds for the **reload path only**. See CR2 for the other paths.
- **UserResponse construction sites.** The only literal constructor is `UserResponse.fromDomain`
  (AuthProtocol.scala:32-42). It has these callers:
  - `AuthService.authResultOf` (AuthService.scala:240-247), used by login, register and OAuth through `finishLogin`;
  - `AuthResult.of` (AuthService.scala:44-53), used by MFA verify;
  - `BetaAccessRoutes.scala:57` (redeem);
  - `ApiRoutes.scala:848`, which is `/me`. Only this one `.copy`s in `preferences`.
  The design's "both UserResponse construction sites" does not match the tree (CR2).
- **An existing per-user preferences store exists and the plan does not address it.** V18 added `users.preferences`
  (JSON TEXT holding `accentColor`) and `user_dashboard_zoom`. `UserPreferenceRepository` reads them, `/api/auth/me`
  returns them as `preferences: {accentColor, zoomLevels}`, `PATCH /api/users/me/update` writes them, and the
  frontend `User.preferences` / `updateUserPreferences` consume them (main.tsx:33-49, PanelList.tsx:202/217). design.md
  cites only `user_dashboard_zoom` (CR3).
- **RLS precedent.** The newest owner-scoped table is V131 `patch_set_applied_proposals`: ENABLE + FORCE, one policy
  `USING (owner_id = current_setting('app.current_user_id')::uuid)`, no WITH CHECK and **no GRANTs**. V133 documents
  two things: the FK-validation scan is subject to FORCE RLS, and RI cascade deletes run without RLS. A cascade from
  `dashboards` into other users' assignment rows is therefore fine. Since V134 creates its tables empty, D7's composite
  FK raises no ADD-CONSTRAINT-on-populated-table issue.
- **D9 query shape is feasible.** `pipeline_roots(pipeline_id, data_source_id)` exists (V98).
  `pipeline_schedules(enabled, next_run_at, last_run_at, kind, expression, timezone)` exists (V62), and its policy is
  owner-only through `pipelines.owner_id`, which matches "the same ownership rule". Two queries are enough.
  `DISTINCT ON` needs a plain `sql"..."` interpolation in Slick, which is a non-blocking note.
- **375px BottomNav arithmetic holds.** 375 − 2×12 (`--bottom-nav-inset` = `--space-3`) − 2 (1px border) −
  2×8 (`padding 0 --space-2`) = 333px usable. 7×44 = 308 ≤ 333, which gives 47.6px per tab. The lozenge
  (22px icon + 2×12px) is 46px and fits inside a 47.6px tab.
- **No OpenAPI document exists.** `git ls-files | grep -iE 'openapi|swagger'` finds nothing, and no tracked file has an
  `openapi:` key. design.md's claim is true. proposal.md's Impact line contradicts it (CR5).
- **D1 at the 768px boundary.** Existing phone CSS uses `@media (max-width: 768px)`: App.css:577 (hides
  `.app-sidebar` at 664), BottomNav.css (`display:flex`), and 37 stylesheets in total. So **768px is a phone width
  today**. `useIsNarrowerThan(768)` evaluates `(max-width: 767px)`, so JS and CSS disagree at exactly 768 (CR4).
  Below 768 the phone DOM is reachable unchanged only if the grid lives entirely in the desktop query.
- **Removing the sidebar lists removes delete UI.** `grep deletePipeline` shows the only UI dispatch is
  `SidebarBody.tsx:153`. `deleteSource` is dispatched only by `SidebarBody.tsx:115` and by `EmptySchemaAffordance.tsx:68`,
  and the latter renders only when a source's schema is missing. Neither `PipelinesPage`, `SourcesPage` nor the
  detail pages has a delete control. The HEL-989 conflict notice and the HEL-1258 reference warning also live only on
  the sidebar path (CR1).
- **Tap-tiling test.** No e2e spec measures `.bottom-nav__tab` geometry (only hel773/hel813 cover the sheet), and
  `BottomNav.test.tsx` runs under jsdom, which cannot measure layout (CR6).
- **Visual reference** (B2Dashboard.png): rail order, folders with mono counts and the avatar at the rail foot match
  D1/D5/D10. It is illustrative only.

### Verdict: REFUTE

### Change Requests

1. **Delete capability regression.** Deleting the desktop `SidebarItemList` lists (D1/D10) removes the app's only
   pipeline-delete UI (`SidebarBody.tsx:152-155`) and its only general source-delete UI (`SidebarBody.tsx:112-125`),
   together with the HEL-989 409-conflict notice and the HEL-1258 reference warning. design.md must say where delete
   goes. Options are a row action in the Recent/Scheduled list, the PipelinesPage/SourcesPage tables, or the detail
   pages. tasks.md needs a task and a test for each that proves delete, the warning and the conflict notice still work.
2. **Preferences on every auth path, not just `/me`.** Login, register, the OAuth callback and MFA verify all take the
   user from `fromDomain`, which has no preferences, and set `currentUser` through SPA navigation with no `/me`
   refetch. Beta redeem then *replaces* `currentUser` through `setAuth` (settingsSlice.ts:345). As planned, the spec
   scenario "signs in on a different browser → renders collapsed on first paint" fails, and redeeming beta access snaps
   the list back to defaults. D2 must list the real call sites (AuthService.authResultOf, AuthResult.of, BetaAccessRoutes
   redeem, /me) and pick a mechanism: populate `uiPreferences` on all of them, or hold prefs in state that `setAuth`
   does not clobber and fetch them before the shell renders. Add a frontend test for the post-login first paint.
3. **Address the existing per-user preferences store.** V18 `users.preferences` (accentColor), the
   `UserResponse.preferences` field and `PATCH /api/users/me/update` already form a per-user server-side UI-preferences
   store, and accent is an appearance setting in HEL-1572's territory. D2 has to reconcile the two. It can extend the
   existing store, or it can justify a second table plus a second embedded field (`preferences` next to
   `uiPreferences`) and say what HEL-1572 does with `accentColor`. Either way the "HEL-1572 extends this, never a second
   table" rule must stay true. The owner ruling requires server-side per-user storage; it does not require a new table.
4. **Pin the 768px boundary.** Today 768px is phone (`max-width: 768px` in App.css:577, BottomNav.css and 35 more
   stylesheets). The plan's "≥768px" rail would render next to the BottomNav at exactly 768, and a
   `useIsNarrowerThan(768)` gate disagrees with that CSS. D1/D6 must state the exact queries for both the CSS grid and
   the JS hook, and they must agree. Task 4.7's 768px screenshot must assert which shell renders. Note that changing
   the phone queries to `max-width: 767px` touches the phone surface (AC5/C1). If that is chosen, say so and scope it.
5. **Fix the OpenAPI contradiction.** proposal.md Impact lists "`openspec` OpenAPI", but design.md (correctly) says no
   OpenAPI document exists. Make them consistent, and state once how AC3's "schema, OpenAPI and tests" is satisfied:
   JSON Schemas plus openspec spec deltas, per the repo's own CLAUDE.md usage. Also name the schema file paths for
   `/api/ui-preferences`; task 1.6 only says "every new request/response".
6. **Name the 375px tiling test.** Task 2.5 cites "the tap-tiling test at 375px", which does not exist, and jsdom
   cannot measure tab widths. Name the Playwright spec that will measure 7 owner tabs at 375px (≥44px each, no
   overlapping hit boxes) and add it to tasks 2.5/4.5.

### Non-blocking notes

- D7 says to follow the precedent's "app-role grants". V131 has none, so drop the phrase or name the grant.
  `user_ui_preferences` keys on `user_id`, not `owner_id`, so write its policy column explicitly.
- `GET /api/dashboard-folders` must return `assignments` only for visible dashboards. Joining `dashboards` under RLS
  handles that, but the folder **count** must use the same filtered set so the counts do not include revoked grants.
- `recentHistoryStore` caps at 10 entries across all kinds, so "max 8" per section can show fewer than 8. Acceptable,
  but say so.
- D11 relabelling §10 is fine (owner ruling). §12's "Five tabs" will conflict with the six-tab phone nav. Leave that to
  the open escalation, and have D11 not restate it.
