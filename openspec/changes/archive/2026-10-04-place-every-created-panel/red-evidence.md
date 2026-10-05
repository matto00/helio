# Red evidence (task 0.7, design D6)

All runs below are on the UNFIXED production tree (only test files and the fixture JSON edited). No production
file was touched before these runs. The route specs run against embedded Postgres, so no row was written to the
shared dev DB; no dashboard/panel/user ids were created by the executor (planning residue in workflow-state.md is untouched).

Commands:
- Backend: `cd backend && nice -n 19 sbt "testOnly com.helio.api.routes.panels.PanelCreatePlacementSpec com.helio.api.routes.dashboards.DashboardLayoutRepairRoutesSpec com.helio.services.panels.PanelServiceDefaultLayoutSpec"` -> `Tests: succeeded 25, failed 16` (after fixing a test-side response parse in the dashboard duplicate/import cases, see below)
- Frontend: `npm --prefix frontend test -- --testPathPatterns="repairPatch|panelThunks.duplicate"` -> `Tests: 2 failed, 5 passed, 7 total` + 1 suite that fails to compile (TS2305)

## Backend red (actual output, trimmed)

```
[info] - should append an orphan to an incomplete (valid) breakpoint, leaving the stored item unchanged *** FAILED ***
[info]   Vector("57f29dad-dcc5-45bc-a9f1-e64e3aa47304") was not equal to Vector("57f29dad-dcc5-45bc-a9f1-e64e3aa47304", "a874c1de-2025-4196-9d9b-572de7e8b768") (DashboardLayoutRepairRoutesSpec.scala:159)
[info] - should fill an empty breakpoint that has live panels *** FAILED ***
[info]   Vector() was not equal to Vector("1115f8c2-fa8b-4578-9d43-9f3e33030369", "2178a03d-bf60-4b63-a677-a728aeb23c1b") (DashboardLayoutRepairRoutesSpec.scala:166)
[info] - should reject an incomplete-breakpoint repair that moves a stored item, naming the breakpoint, and store nothing *** FAILED ***
[info]   200 OK was not equal to 400 Bad Request (DashboardLayoutRepairRoutesSpec.scala:173)
[info] - should store an item in lg, md, sm and xs for every panel kind, valid and non-overlapping *** FAILED ***
[info]   no lg item for bcaaa1ea-9bfd-4592-a0ba-48bce5f42e60 (PanelCreatePlacementSpec.scala:50)
[info] - should give a text panel the client's per-breakpoint default size at the origin of an empty dashboard *** FAILED ***
[info]   no lg item for fb5f694e-ef60-4823-b07c-83448de39646 (PanelCreatePlacementSpec.scala:50)
[info] - should return the stored per-breakpoint items in the response *** FAILED ***
[info]   response carries no layouts (PanelCreatePlacementSpec.scala:62)
[info] - should store both placements when two panels are created concurrently *** FAILED ***
[info]   Vector() had size 0 instead of expected size 4 (PanelCreatePlacementSpec.scala:118)
[info] - should never overlap an existing item even when a breakpoint was stored with items below another's bottom *** FAILED ***
[info]   no lg item for 15ccd483-eca6-4903-868b-e523d854ccaf (PanelCreatePlacementSpec.scala:50)
[info] - should store and return an item per breakpoint for every created panel, stacked in request order *** FAILED ***
[info]   response carries no layouts (PanelCreatePlacementSpec.scala:62)
[info] - should store and return an item below the existing ones and keep the source size *** FAILED ***
[info]   no lg item for 959dec60-8635-4782-9d37-271e4a9c25df (PanelCreatePlacementSpec.scala:50)
[info] - should scale the source's lg size into a breakpoint where the source has no item *** FAILED ***
[info]   no sm item for 1e8588f6-9420-4c23-8ead-39dc5d91a259 (PanelCreatePlacementSpec.scala:50)
[info] - should use the kind default size when the source is orphaned everywhere *** FAILED ***
[info]   no lg item for 15f1e060-c527-4e31-b439-dee59cf1b1a6 (PanelCreatePlacementSpec.scala:50)
[info] - should give a panel with no authored placement an item in every breakpoint and keep the authored one *** FAILED ***
[info]   no lg item for 7221ac60-a930-4b94-815e-5c869f9cc890 (PanelCreatePlacementSpec.scala:50)
[info] - should stay faithful in a dashboard duplicate and be accepted by the owner repair appended *** FAILED ***
[info]   java.util.NoSuchElementException: key not found: id
[info] - should stay faithful in an export-then-import and be accepted by the owner repair appended *** FAILED ***
[info]   java.util.NoSuchElementException: key not found: id
[info] - should place a non-Output panel at the content default size per breakpoint and write the dashboard layout (HEL-1260) *** FAILED ***
[info]   None was not equal to Some((4, 4, 3, 2)) (PanelServiceDefaultLayoutSpec.scala:265)
[info] *** 16 TESTS FAILED ***
[error] Failed tests:
```

Cases that PASS on the unfixed tree are guards, not reds, and are labelled as such:
- "keep the Output default size ... byte-identical" - behaviour-preserving guard for the single Output create.
- "leave the stored layout ... accepted ... after every create path" - the seam (D7). Vacuous on the unfixed tree
  (nothing is stored to re-send); becomes meaningful after the fix (see mutation section).
- "leave the stored layout unchanged when the batch is rejected" - guard (rejection must not start writing a layout).
- "let stored-bad rules win over append-only" - guard: today's stored-bad path must keep working once repair widens.

The two dashboard duplicate/import cases first failed with `NoSuchElementException: key not found: id`: a test-side
bug (the response nests the dashboard under `dashboard`). After fixing that, a re-run on the still-unfixed tree
(`-z orphan`, `Tests: succeeded 0, failed 3`) fails them at `PanelCreatePlacementSpec.scala:50`
(`no lg item for <panel>`): the repair endpoint returns 200 without storing an item for the orphan.

## Frontend red (actual output, trimmed)

```
5:FAIL src/features/panels/state/panelThunks.duplicate.test.ts
6:  ● duplicatePanel thunk › adopts the server's per-breakpoint placement, appended to each breakpoint's own layout
38:FAIL src/features/dashboards/state/repairPatch.seam.test.ts
39:  ● stored-layout repair seam fixture (shared with the backend DashboardLayoutRepairSeamSpec) › valid breakpoints missing a live panel get it appended, stored items unchanged
124:FAIL src/features/dashboards/state/repairPatch.test.ts
125:  ● Test suite failed to run
127:    [96msrc/features/dashboards/state/repairPatch.test.ts[0m:[93m1[0m:[93m28[0m - [91merror[0m[90m TS2305: [0mModule '"./repairPatch"' has no exported member 'hasRepairableBreakpoint'.
133:Tests:       2 failed, 5 passed, 7 total
```

- `repairPatch.seam.test.ts`: new fixture case "valid breakpoints missing a live panel get it appended" - client returns `{}`
  (`Object {}`) where the fixture expects the four appended breakpoints.
- `panelThunks.duplicate.test.ts`: the copy's item is not adopted (layout stays `[src]`).
- `repairPatch.test.ts`: fails to compile, `hasRepairableBreakpoint` does not exist.

## Green after the fix

```
$ cd backend && nice -n 19 sbt testFull          # exit=0
[info] Total number of tests run: 5740
[info] Suites: completed 398, aborted 0
[info] Tests: succeeded 5740, failed 0, canceled 0, ignored 0, pending 0
[info] All tests passed.
$ npm run lint                      # exit 0 (eslint . --max-warnings=0)
$ npm run format:check              # exit 0 (All matched files use Prettier code style!)
$ npm test                          # exit 0, frontend: Test Suites: 424 passed, Tests: 4398 passed
$ npm run typecheck                 # exit 0
$ npm --prefix frontend run build   # exit 0
```

An earlier full `testFull` (before the last two test-only edits) had exactly 2 failures, both tests that encoded the old
behaviour (3.6): `AutoLayoutRouteSpec` "400 for a panelId not on the dashboard, no persistence" (asserted an empty lg right
after a create) and `FormPanelRoundTripSpec` "layout is null/absent for a form panel". Both were updated and the final run is clean.
`FirstRunRoutesSpec` did not time out in either full run. The known flakes (PanelCard.test.tsx:625, ProductEventRollupServiceSpec) did not fire.

One production bug was found by the concurrency test during implementation: inserting the panel before taking the dashboard
row lock deadlocked two concurrent creates (the insert's FK KEY SHARE lock conflicts with the other transaction's `FOR UPDATE`;
Postgres log `ERROR: deadlock detected`). Probe: 4 concurrent creates returned `500`. Fix: lock first, then insert (documented in
`PanelLayoutPlacement`).

## Mutation (task 3.9) - actual runs

Mutation 1 (placer reverted to Output-only: only panels whose size is not the content default are stored) and mutation 2 (repair
reverted to stored-bad-only, server `DashboardLayoutRepair.plan` and client `repairableBreakpoints`), applied together, then reverted:

```
$ sbt "testOnly ...PanelCreatePlacementSpec ...PanelCreateSeamSpec ...DashboardLayoutRepairRoutesSpec ...DashboardLayoutRepairSeamSpec ...PanelServiceDefaultLayoutSpec"
[info] Tests: succeeded 35, failed 23, canceled 0, ignored 0, pending 0
  red: PanelCreatePlacementSpec (every kind / text sizes / response / concurrent / below-bottom / batch / duplicate-orphan / editor grantee x2 / dashboard duplicate+import)
  red: PanelCreateSeamSpec (output-text-markdown..., batch, pending-drag)
  red: DashboardLayoutRepairRoutesSpec (append / fill empty / reject move)
  red: DashboardLayoutRepairSeamSpec (all 6 cases: expected repair now also covers md/sm, incomplete-only)
$ npm --prefix frontend test -- --testPathPatterns="repairPatch|storedLayoutRepair"
Tests:       13 failed, 14 passed, 27 total
  red: hasRepairableBreakpoint x2, buildRepairPatch incomplete x3, seam fixture x5, PanelGrid orphan class 3 + stale class 4
```

`PanelServiceDefaultLayoutSpec` stays green under mutation 1 on purpose: it mocks `insertPlaced`, so it guards the SIZE the service chooses, not the store;
the stored result is guarded by `PanelCreatePlacementSpec`/`PanelCreateSeamSpec`. After the run all three mutated files were restored from copies
(verified: no `kept(` in `CreatePlacement.scala`, `isIncomplete(` back in `plan`, `held` back in `repairPatch.ts`), and the focused specs re-ran green.

## Live check (task 3.11) on this worktree's servers (6692 / 9599; `readlink /proc/<pid>/cwd` = this worktree)

The backend that was running predated the change, so its pid was killed (pid 2402940, verified as this worktree's sbt java) and restarted with
`scripts/concertino/start-servers.sh <wt> 6692 9599 HEL-1260`.

- psql probe of the stored JSON for a text panel created through the API: `select layout::text from dashboards where id='<id>'` returned all four breakpoints,
  each with one item for the panel: lg 4x5, md 4x5, sm 3x5, xs 2x5, all at x=0,y=0.
- Playwright (headless, own browser context, `DEV_PORT=6692`), `e2e/hel1260-orphan-owner-repair.spec.ts`, 4 tests, light and dark:
  (a) owner opens a dashboard whose text panel has no stored item: exactly one `POST /layout/repair` carrying lg/md/sm/xs, stored layout then has an item for the panel in
  all four breakpoints, "Unsaved changes" never appears, no layout PATCH, reload leaves the item's bounding box unchanged and sends no second repair;
  (b) text panel created through the UI (Dashboard actions > Add panel > Add Text panel): stored layout (via the API read of the dashboards row) has 1 item per breakpoint,
  the box is unchanged after reload, no repair POST. Result: 4 passed in each of 5 consecutive full runs (20/20) at the end.
  The FIRST 6 runs right after the backend restart showed 3 failures of test (a) (repair POST not observed within 15s; no trace kept, not reproduced in the following 36 runs, including with request/console logging). Reported as an unexplained transient, not as a pass.
- `e2e/hel1023-breakpoint-layout-derivation.spec.ts` A/B/C/D passed with `stubOwnerRepair` applied to A/B; V_valid_with_gaps failed once in a sequence ("V light @1200 (sm) P1 Image w", 59px) and passed 3/3 alone (that state is complete and valid, so no repair or placement path is involved).
  `e2e/hel1230-drag-then-create-persists.spec.ts` passed.

## Shared dev DB ids created by the executor (delete only by exact id; users cannot be deleted through the API)

- Live probe dashboard `fef2a743-1671-4361-b89e-9a395811445b` (panel `ff119bea-1db1-4ed7-a8db-c7392321eab8`): dashboard DELETED by exact id (204, verified count 0; the panel cascades). User `hel1260-live-1791173990@example.test` remains.
- Playwright throwaway users (each test registers one; each test deletes its own dashboard by exact id in `finally`): `hel1260-*@example.test` (printed per run as `[HEL-1260 e2e] throwaway user: ...`) and `hel1023-*@example.test` / `hel1230-*@example.test` from the existing specs. Dashboards from those runs were deleted by their own tests; the users remain (existing practice for these specs).
- The route specs use embedded Postgres, not the shared DB.
