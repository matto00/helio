## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `16a430fe580897a1afdde94cd0b56c44e7fe32bd` (branch `bug/delete-panel-layout-ghosts/hel-1456`).
Diff base, resolved live by `resolve-review-base.sh`: `dae4bc4516791452ad5b3e27e871d39771bbd5a6`, which is the merge-base with
origin/main. The branch is not rebased on current main. Per the brief that is handled at delivery and does not fail this review.

### Phase 1: Spec Review — PASS
- AC1 (single delete strips every breakpoint, same transaction, same locking): V122 is a statement-level AFTER DELETE
  trigger. It locks dashboards `FOR UPDATE` in id order, which is the row lock `PanelLayoutPlacement` takes, and runs in the delete's
  transaction. Covered by `PanelDeleteLayoutStripSpec` and `V122StripDeletedPanelLayoutItemsSpec`. I reproduced it live (see Phase 3).
- AC2 (bulk `deleteByOutputIdInternal`): the trigger covers it by construction. Covered by the bulk-statement case and the
  Output-delete route case.
- AC3 (one-off repair): V123 uses a `helio_privileged` SECURITY DEFINER helper with `row_security = off`, then drops it. It is
  tested as a NOBYPASSRLS owner with live items byte-identical, and it is idempotent. This honours constraint C1.
- AC4 (no gap after a create, no auto-layout offset): both have route-level tests, RED first in `red-run-1.log`.
- Driver additions: the cascade paths (Output, pipeline, step) are tested. `replaceContents` and dashboard delete are covered
  by tests labelled as guards. RLS proofs run as a NOSUPERUSER NOBYPASSRLS role (C2). The lost-ownership tripwire (42501) is tested.
  The seam test is present: the client half and the server half share `shared-test-fixtures/layout-ghost-write-seam.json`.
  `[hel1468-guard]` appears in my sbt run. The HEL-1457 interaction is stated in design D6.
- Owner rulings `approve-v123` and `server-filter` are implemented as D4 and D5. D7 is the only patch-set edit and is minimal.
- Every task in tasks.md is checked and matches the diff. The spec delta matches the behaviour, including "silently
  dropped, not rejected".
- Fixture changes in 3 existing specs (`DashboardLayoutValidationSpec`, `ApiRoutesSpec` "update dashboard layout",
  `DashboardServiceLayoutPolicySpec`): I checked these against the fixture-masks-defect pattern. They are legitimate. The old fixtures wrote
  layouts for panel ids that never existed on the dashboard (`p1`, `p2`, `panel-a`). Under the new, spec-stated contract (D5 and
  the "Layout writes never store items for panels not on the dashboard" requirement), those items are dropped by design.
  The diff confirms that every assertion is unchanged apart from the id substitution. The stored-bad grandfathering, overlap, out-of-bounds,
  whitespace-id and undo-after-repair semantics are all still exercised, now against real panel rows.
- The executor's claim that a rename-only PATCH does not touch layout is correct. `DashboardWrites.scala:79-80` returns `renamed` without
  a layout write. Rename combined with appearance or layout is filtered at `:84`.

### Phase 2: Code Review — FAIL
Gates. I ran them myself in WORKTREE_PATH at 16a430fe5. The logs are in `.concertino/runs/HEL-1456/evidence/`:
- `npm run lint`: exit 0. `npm run format:check`: exit 0.
- `npm test`: 504 suites, 5269 tests passed (`evaluator-1-jest.log`).
- `npm --prefix frontend run build`: exit 0 (`evaluator-1-build.log`).
- `sbt testFull` (`nice -n 19`, `-J-Xmx3g`): 6715 succeeded, 0 failed, 4 canceled, "All tests passed". The
  `[hel1468-guard] ScalaTest summary: failed=0 aborted=0` line is present (`evaluator-1-testFull.log`). All 7 new specs and the
  changed `DashboardLayoutValidationSpec` executed. Flyway logged `hel1456_repair_ghost_layout_items | 0` on the fresh DB.
- `npm run check:scala-quality`: clean. There are no inline-FQN violations, and the file-size warnings were already there.

RED-first and mutation evidence. I checked the executor's logs rather than taking them on trust:
- `red-run-1.log`: 30 failed.
- `red-run-2-migrations-present.log`: 17 failed with V122/V123 present and no D5/D7.
- `red-run-3-d5-d7-final-tests.log`: 15 failed.
- `mutation-1` (no re-own and no `row_security=off`): 6 failed, including the V123 live-item wipe and the RLS cascade cases.
- `mutation-2` (filter on supplied breakpoints only): 7 failed.
The tests labelled as guards match design.md "Implementation Notes".

Issues:
1. **DRY: about 45 lines of route-test helpers copied verbatim between two new files.** These helpers appear in both
   `backend/src/test/scala/com/helio/api/routes/panels/PanelDeleteLayoutStripSpec.scala:14-67` and
   `PanelDeleteLayoutStripConcurrencySpec.scala:17-71`, character for character: `send`, `createDashboard`, `createPanel`, `deleteOk`, `itemsOf`, `idsOf`,
   `PipelineFixture`, `outputIds` and `createPipeline`. Inside each file, the body-shape match
   (`case JsArray(xs) => xs; case o: JsObject => o.fields("items")...`) is also duplicated between `outputIds` and `createPipeline`.
   `DashboardLayoutGhostWriteSpec.scala:30-41` and `DashboardLayoutGhostSeamSpec.scala:18-22` add two more copies of
   `createDashboard`/`createPanel`/`createDivider`. Splitting the concurrency spec into its own class (to get its own rate-limit bucket) is a good reason
   for a separate class, but it is not a reason to fork the fixture code.

Everything else passes:
- V122/V123 SQL: the COALESCE gives `[]`, not null. Non-array breakpoints are preserved. Rows are skipped with `IS DISTINCT FROM`. There is no `last_updated` bump.
  The V100 re-own bracket is followed. `ENABLE ALWAYS` follows V99's precedent.
- D5: the stored and supplied sides are both filtered before the policy runs. `panelIdsInternal` is read after `existing`, so no live
  panel can be dropped by the filter that was not already absent from `existing`.
- D7: `panelIdsInternal` is called only after `findById` returns Some.
- Type safety, error handling and security are fine: there is no new input surface and no untyped escape hatches.

### Phase 3: UI Review — PASS
Triggered by `frontend/**` (a test file only; there is no frontend source change).
- Servers came up through `start-servers.sh` on 6888/9795, and `assert-phase.sh servers` printed PASS. These were fresh processes started from
  this worktree, not a reused server. I shut them down afterwards with `kill` on their exact PIDs.
- The shared Playwright MCP browser was logged in as another lane's account (HEL-1481 eval user). I did not use that session.
  I ran the UI checks in an isolated Playwright context (a node script that loads the playwright library from the repo) with my own
  throwaway account, `hel1456-eval1-1791698848@example.test`.
- Live API repro, with `X-Helio-Requested-With: 1` (a request without it got 403):
  - Create A and B, then `DELETE` B (204): B was gone from lg/md/sm/xs.
  - Create C: C landed at y=5 (A's bottom) on every breakpoint, so there is no gap.
  - A PATCH carrying B's ghost item got a response with no ghost, and the stored layout had no ghost.
  - Created a pipeline and Output, bound a panel, then `DELETE /api/pipelines/:id` (204): the bound panel's item was stripped from all 4 breakpoints.
- UI delete flow at 1440: opened "Victim panel actions", chose "Delete" (keyboard focus + Enter), then chose the inline "Confirm" (keyboard).
  The panel was removed and the "Panel deleted." toast appeared. The only mutation the client sent was `DELETE /api/panels/:id`. The server
  layout then held no Victim item in any breakpoint. There were 0 console errors and 0 page errors.
- Breakpoints 1440/1100/768/375 rendered with no breakage. Evidence:
  `.concertino/runs/HEL-1456/evidence/evaluator-1-ui/after-ui-delete-{1440,1100,768,375}.png`, `with-victim-1440.png` and
  `aria-menu.yml`. These are already in the durable run evidence dir. The screenshots support only "renders, no breakage". No claim
  here rests on mtime.
- Cleanup: I deleted dashboard `b2ea7114-0d52-46a4-ace4-e0e1f25acf1d` (its panels went with it) and data source
  `18b39e49-b1ca-4c9e-b7fd-1fb23a4c811f` by exact id. The pipeline `2aecb65c-…` had already been deleted during the test. The throwaway
  user row is still there because there is no user-delete endpoint. I did not touch the owner's account.

### Overall: FAIL

### Change Requests
1. Extract the shared route-test helpers into one trait, for example `backend/src/test/scala/com/helio/api/routes/panels/PanelLayoutStripRouteFixtures.scala`
   (`trait … { self: ApplyProposalSpecBase => … }`). It should hold `send`, `createDashboard`, `createPanel`, `deleteOk`,
   `itemsOf`, `idsOf`, `PipelineFixture`, `outputIds`, `createPipeline` and a single `itemsArray(body: JsValue)` helper for the
   `JsArray | {items}` body-shape match.
   - Mix the trait into `PanelDeleteLayoutStripSpec` and `PanelDeleteLayoutStripConcurrencySpec`, and delete their copies
     (`PanelDeleteLayoutStripSpec.scala:14-67`, `PanelDeleteLayoutStripConcurrencySpec.scala:17-71`).
   - Use the same trait's `createDashboard`/`createPanel` in `DashboardLayoutGhostWriteSpec.scala:30-41` and
     `DashboardLayoutGhostSeamSpec.scala:18-22`. If you keep the `divider` kind there, pass it as `kind`.
   - Keep the concurrency spec as its own class, for its separate rate-limit bucket.
   - This changes the tests only, so re-running the affected specs is sufficient evidence. No new RED run is needed.

### Non-blocking Suggestions
- `PatchSetPreviewProjection.scala:214-218` says preview applies "the same layout policy `DashboardService.update` applies, so a
  preview of an invalid layout 400s exactly like the apply would". After D5 that is no longer true for items naming panels that
  are not on the dashboard. Preview keeps them and validates them, so a ghost item that overlaps a live one returns 400 in preview but 200 in apply. The
  preview "after" JSON also shows items that apply drops. This is low-impact after V123, and patch-set edits beyond D7 are out of scope (HEL-1482 lane).
  Suggest filing a follow-up, or at least noting the divergence in the PR body.
- `PatchSetUndoConflictCheck.scala:128-130` re-implements `LayoutPolicy.onlyPanels` over `DashboardLayoutResponse`. Consider sharing the
  filter: either convert both sides to domain and use `onlyPanels`, or add a response-level helper next to it.
- `DashboardLayoutGhostWriteSpec` "keep the item of a panel created by another user": neither the RED run nor mutation-2
  fails it *because of* an RLS-limited lookup. Both fail on the ghost assertion. To make it a real proof of the
  `panelIdsInternal` (privileged, unpaged) choice, run one mutation that swaps in a user-scoped panel lookup and record whether it
  goes red. If it does not go red, the dashboard owner can see editors' panels under RLS and the test should be relabelled as a guard.
- `V122` grants `SELECT ON panels` to `helio_privileged`, but the trigger reads only the transition table. This is harmless, and V122 must not
  be edited, so there is nothing to change. It is noted for the record only.
