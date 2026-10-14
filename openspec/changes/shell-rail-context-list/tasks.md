## Standing Constraints

- [C1] At 768px and below, nothing changes except the BottomNav's leading Home tab. Verify at 375, 390 and 768px in both themes against main.
- [C2] Use tokens only: no literal colours, fonts or durations. `--app-surface` stays #1a1816. The accent goes only on the active rail item, the primary action, selection and focus.
- [C3] Prove RLS on the two new folder tables in a NOBYPASSRLS session, not only as superuser. The preferences write is isolated in the app (`users` has no RLS) and proven by a route test.
- [C4] Resource caps: jest at most 3 workers, `nice -n 19`, at most 3-4 parallel workers. Bash calls use `timeout: 600000`.
- [C5] The rail grid is the default layout, overridden under the existing `(max-width: 768px)` query. `useIsPhoneShell` uses the same query. No new breakpoint value is introduced (DESIGN.md §4).

### Backend

## 1. Backend

- [x] 1.1 Re-check origin/main's newest migration, then add `V134__dashboard_folders.sql` (D7). Verify that Flyway migrates in `sbt testFull`.
- [x] 1.2 Add domain types, a Slick repository and `DashboardFolderService` (D8) on the RLS-scoped pool. Verify it compiles.
- [x] 1.3 Add the folder CRUD routes and `PUT /api/dashboards/:id/folder` with `JsonProtocols`. Verify with the route specs (4.1).
- [x] 1.4 Add `GET /api/pipeline-schedules` returning `items` + `sources` in two queries total (D9). Verify with a route spec (4.2).
- [x] 1.5 Make `upsertGlobalPrefs` a JSON merge, and add the shell keys plus `PATCH /api/users/me/preferences` (D2). Verify with the spec (4.4).
- [x] 1.6 Grep every `UserResponse.fromDomain` caller and route each one through one helper that attaches preferences (D2). Verify with the spec (4.4).
- [x] 1.7 Add the JSON Schemas: folder schemas under `schemas/dashboards/`, `schemas/pipelines/pipeline-schedule-list-response.schema.json`, and `schemas/auth/user-preferences.schema.json` + `update-user-preferences-request.schema.json`. Verify that `npm run check:schemas` passes.

### Frontend

## 2. Frontend: shell

- [x] 2.1 Add `useIsPhoneShell` (C5) and `useContextListLayout`: auth-slice prefs, clamp 200..400, default 248, one write per drag, a 400ms key debounce, and the legacy-key migration. Verify the unit tests.
- [x] 2.2 Add `AppRail` (D5) plus `ContextList` and `ContextListSeparator` (D3). Verify unit tests for keyboard, pointer and double-click.
- [x] 2.3 Re-lay `App.tsx` as the D1 grid. Delete `app/Sidebar.tsx` and the desktop-only `SidebarBody` paths. Verify `npm run typecheck`.
- [x] 2.4 Move the avatar `UserMenu` to the rail foot above 768px and add the owner-only Usage item (D6). Make `setAuth` keep preferences. Verify the unit tests.
- [x] 2.5 Add the shared Home alias to `BottomNav` as the first tab, never marked active. Verify `BottomNav.test.tsx` (order, single active).
- [x] 2.6 Paint the rail and the list per D4 in both themes. Verify `npm run lint` and the CSS guard tests.

## 3. Frontend: section content

- [x] 3.1 Add `dashboardFoldersSlice` and its service calls. Verify the slice tests.
- [x] 3.2 Extend `DashboardList` with folder groups, RLS-consistent counts, Unfiled, create/rename/delete/collapse and "Move to..." (D10). Verify the tests.
- [x] 3.3 Add the `scheduledItems` slice. Pipelines body: Recent + Scheduled. Sources body: Recent + Scheduled (soonest run). Both get View all + add. Verify the tests.
- [x] 3.4 Assistant keeps its conversation list. Connectors, Settings and review pages render no list. Verify the tests.
- [x] 3.5 Add Delete to `PipelineDetailHeader`'s actions and `SourceDetailPanel.tsx`'s header (fetching references on mount), with the warning and the conflict notice (D12). Verify the tests.
- [x] 3.6 Update DESIGN.md §9 and §12, and relabel the §10 driver defaults as owner rulings (D11). Verify with prettier.

### Tests

## 4. Tests and verification

- [x] 4.1 Backend route specs for folders: CRUD, duplicate and invalid names, 404s, move and unfile, a granted dashboard, delete cascade.
- [x] 4.2 Backend route spec for `GET /api/pipeline-schedules`: own enabled schedules only, ordering, empty result, a source feeding several pipelines shows the soonest run, a source feeding only disabled schedules is absent.
- [x] 4.3 Backend RLS spec under a NOBYPASSRLS role: cross-user select, insert and update are blocked on both folder tables (C3).
- [x] 4.4 Backend specs for preferences: partial PATCH, 400 cases (including an unknown field, which needs an explicit key check), 401, the accent/shell merge in both orders, B's PATCH leaving A's preferences byte-identical, and preferences present on `/me`, login, register, OAuth, MFA verify and beta redeem.
- [x] 4.5 Frontend tests: rail items with a single `aria-current`; separator accessibility and clamps; first-paint prefs with no default flash; one PATCH per drag; the legacy key; no full pipelines list; detail-page delete.
- [x] 4.6 Add the Playwright spec `e2e/hel1574-shell-rail.spec.ts`. At 768px the phone shell renders with no rail; at 769px and 820px the rail renders. At 375px an owner's 7 BottomNav tabs are each 44px or wider and do not overlap.
- [x] 4.7 Run the full gates: `npm run lint`, `npm run typecheck`, `npm test` (3 workers), `sbt testFull`, `npm run check:schemas`.
- [x] 4.8 Check the running app in both themes at 1280, 820, 768 and 375px, and save screenshots as evidence.
