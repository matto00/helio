## Standing Constraints

- [C1] Red first: every new backend concurrency spec is shown failing on the unfixed code before the fix, using real concurrent transactions on `VerifiedEmbeddedPostgres.start` as a non-superuser NOBYPASSRLS role; `[hel1468-guard]` appears in every sbt run log.
- [C2] Never edit V122/V123; the new migration takes the next free number (re-check `origin/main` right before committing).
- [C3] No new lock acquisition order: layout writes take no panel-row locks; if any lock is added it follows "panel rows, then the dashboard" (HEL-1485).
- [C5] Version invariant I1 (design D7): the `expectedLayoutVersion` sent is never newer than the server layout the saved local layout was derived from.
- [C4] No inline FQNs; `nice -n 19` on heavy jobs; at most one sbt testFull per lane; shut down every sbt server started.

### Backend

## 1. Reproduce (red)

- [x] 1.1 Add `DashboardLayoutConcurrencySpec` (embedded PG, NOBYPASSRLS role) driving the HTTP route with raw JSON: a second connection holds the dashboard row lock; the PATCH (carrying `expectedLayoutVersion`) is started; commit in the second connection ONLY after `pg_stat_activity` shows the PATCH's backend `wait_event_type = 'Lock'`; assert the committed placement is kept (409) and, in a separate case, a committed rename survives a layout save. Record the red run log in the run evidence dir.
- [x] 1.2 No-precondition variant asserts only D4: rename/appearance kept, unsent breakpoints kept, placement in an UNSENT breakpoint kept (never "kept" in a supplied breakpoint).

## 2. Schema

- [x] 2.1 Add migration `V<next>__dashboard_layout_version.sql`: `layout_version bigint NOT NULL DEFAULT 0` + `BEFORE UPDATE ... WHEN (NEW.layout IS DISTINCT FROM OLD.layout)` bump trigger; verify via a spec that a panel create, delete (V122) and rename change/keep the version as specified.

## 3. Repository and services

- [x] 3.1 Domain `Dashboard.layoutVersion` (appended, defaulted) and row mapping; verify compile + existing repository specs pass.
- [x] 3.2 Repository: layout CAS (`layout`, `last_updated` where `layout_version = ?`), targeted name/appearance writes, composed in one transaction returning the re-read row; remove `update`/`updateName` once unused; verify spec covers conflict vs not-found.
- [x] 3.3 `DashboardWrites`: one transaction, supplied fields only, CAS token = `expectedLayoutVersion` or read version, bounded 3-attempt retry without a precondition, 409 `LayoutConflict` on miss, and an immediate 409 when a supplied `expectedLayoutVersion` differs from the version just read (no merge against a stale read); verify `DashboardServiceSpec` cases.
- [x] 3.4 `AutoLayoutService`: CAS write (layout + last_updated only), optional precondition, bounded retry; update the HEL-1485 deferral comment; verify auto-layout specs.
- [x] 3.5 Protocol: `layoutVersion` on `DashboardResponse`, `expectedLayoutVersion` on `UpdateDashboardRequest`/`AutoLayoutRequest` (400 without `layout` or negative); update `schemas/dashboards`; `expectedLayoutVersion` defaults to `None` (positional constructions keep compiling); verify route specs + schema drift check.
- [x] 3.6 `ServiceError.LayoutConflict(current)` → 409 `{message, dashboard}`; verify route spec.
- [x] 3.7 Insert/duplicate/import never write a non-zero `layout_version` (leave it out of the insert or write 0); verify duplicate/import specs.

### Frontend

## 4. Client

- [x] 4.1 `Dashboard.layoutVersion` type; `dashboardService.updateDashboardLayout` sends `expectedLayoutVersion`; verify service test.
- [x] 4.2 `useLayoutSave` (normal save too: advance the version only when the adopted layout derives from what was sent): `persistedVersionRef` paired with `persistedLayoutRef` (server data only); pass version + base to the thunk; do not advance baseline/version after a retry when the store kept a newer local edit (D7c); verify hook tests.
- [x] 4.2b Reducers: keep-local branches of `updateDashboardLayout.fulfilled`/`repairDashboardLayout.fulfilled` keep the OLD `layoutVersion` (D7a); verify slice tests.
- [x] 4.3 `updateDashboardLayout` thunk: on 409 refetch, per-panel rebase, validity check, retry once, else upsert fresh + reject with the conflict message; refetch panels when the adopted layout has unknown panel ids (D7e); verify jest tests for success-after-rebase, invalid-rebase, double-409, and a second drag during the 409 round trip whose next flush never drops the other writer's item (D7c).

### Tests

## 5. Verification

- [x] 5.1 Backend specs: stale-tab PATCH after placement → 409 + nothing lost; in-flight placement race → 409; concurrent rename survives a layout save; auto-layout racing a create keeps the panel; matching version saves and bumps. All green after the fix, red before (C1).
- [x] 5.2 Route/protocol specs: `layoutVersion` present; 400 for precondition without layout; 409 body.
- [x] 5.3 e2e: open a dashboard, create a panel through the API as the same throwaway user, drag a panel, Save now, reload; both the new panel and the dragged position persist.
- [x] 5.4 Full gates: `npm run lint`, `npm run typecheck`, `npm test`, `sbt testFull` (with `[hel1468-guard]` in the log), affected e2e.
