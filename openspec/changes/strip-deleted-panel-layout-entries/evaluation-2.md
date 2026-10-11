## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: `af47ebb4a755782a338cf63fefd41d23e207df98` (branch `bug/delete-panel-layout-ghosts/hel-1456`).
I resolved the diff base live with `resolve-review-base.sh`: `dae4bc4516791452ad5b3e27e871d39771bbd5a6`. This cycle's delta is
`16a430fe5..af47ebb4a`. It changes one main-code file (`PatchSetUndoConflictCheck.scala`), five test files and `design.md`, and it commits
`evaluation-1.md`.

### Phase 1: Spec Review — PASS
Issues: none.
- Phase 1 passed in cycle 1 and still holds. The cycle-2 delta changes no behaviour (see Phase 2) and no AC, task or spec.
- design.md "Implementation Notes" now records the cycle-2 mutation (`cycle2-mutation-3-user-scoped-panel-lookup.log`), so it matches the evidence.
- Constraints:
  - C1: the V122 and V123 SQL is untouched since cycle 1.
  - C2: the cycle-2 mutation adds a red proof for the "panel created by another user" case. The other cycle-2 changes are test refactors, and
    cycle 1 waived a new RED run for those.

### Phase 2: Code Review — PASS
I ran the gates myself at af47ebb4a, in WORKTREE_PATH:
- `npm run lint`: exit 0. `npm run format:check`: exit 0, "All matched files use Prettier code style!".
- `npm run check:scala-quality`: "clean". It printed only the existing soft file-size warnings.
- I did not re-run `npm test` or `npm --prefix frontend run build`. `git diff 16a430fe5 af47ebb4a -- frontend shared-test-fixtures schemas` is empty,
  so the frontend tree is byte-identical to the one cycle 1 gated (`evaluator-1-jest.log`: 504 suites and 5269 tests passed; `evaluator-1-build.log`: exit 0).
- Backend: I ran targeted specs rather than a full `sbt testFull`. The command was `nice -n 19 sbt -J-Xmx3g "testOnly com.helio.services.patchsets.* com.helio.api.routes.patchsets.*
  com.helio.api.routes.panels.PanelDeleteLayoutStrip* com.helio.api.routes.dashboards.DashboardLayout* com.helio.services.dashboards.*
  com.helio.infrastructure.persistence.panels.V12* com.helio.api.ApiRoutesSpec"`. Result: 34 suites, 442 tests, 0 failed, "All tests passed", and
  `[hel1468-guard] ScalaTest summary: failed=0 aborted=0`. I checked by name that every new or changed spec ran:
  - PatchSetUndoGhostLayout, PatchSetUndoPanelDashboard, PatchSetUndoRefusal and PatchSetUndoRoutes
  - PanelDeleteLayoutStrip and PanelDeleteLayoutStripConcurrency
  - DashboardLayoutGhostWrite, DashboardLayoutGhostSeam and DashboardLayoutValidation
  - V122 and V123
  - ApiRoutesSpec

  Log: `.concertino/runs/HEL-1456/evidence/evaluator-2-targeted-specs.log`.
  - Why not a full testFull: the cycle-1 full run at 16a430fe5 was green, with 6715 succeeded. Since then, the only main-code change is inside
    `PatchSetUndoConflictCheck.checkDashboard`. Its only caller is `PatchSetUndoService`, and every undo spec, service-level and route-level, is in the targeted set.
    The test-only changes are covered because testOnly compiles the whole test tree and runs every affected spec. Two other lanes' `testFull` JVMs were also
    running at the time (HEL-1482 and HEL-1311). I waited until at most one other was left before starting my run.

Verification of the cycle-1 change request and suggestions:
1. **CR1 (DRY route-test fixtures): resolved.** The new `backend/src/test/scala/com/helio/api/routes/LayoutRouteFixtures.scala` holds the helpers, as a
   self-typed `this: ApplyProposalSpecBase =>` trait:
   - `send`, `createDashboard`, `createPanel` (`kind` parameter), `deleteOk`, `itemsOf`, `idsOf`, `PipelineFixture`, `outputIds` and `createPipeline`
   - one private `listIds` for the `JsArray | {items}` body shape
   - `Bps`

   All four specs mix it in, and their copies are deleted:
   - `PanelDeleteLayoutStripSpec`: -54 lines
   - `PanelDeleteLayoutStripConcurrencySpec`: -55 lines, still its own class
   - `DashboardLayoutGhostWriteSpec`: `createDashboard`/`createPanel`/`Bps` removed, now uses `createPanel(d, "divider")`
   - `DashboardLayoutGhostSeamSpec`: `createDivider` removed

   No assertion changed. The diff swaps call sites only.
2. **D7 reuse of `LayoutPolicy.onlyPanels`: done, and it preserves behaviour.** `PatchSetUndoConflictCheck.scala:128-132` converts both response layouts to domain
   and filters them with `LayoutPolicy.onlyPanels(layout, panelIds: Set[PanelId])`. The old code filtered `String` ids against `panelIds.map(_.value)`. The new code filters
   `PanelId` against `panelIds`. Both sides go through the same function, and the comparison is case-class equality in both versions, so the set of layouts
   that compare equal is unchanged. The undo specs pass.
3. **Mutation for "keep the item of a panel created by another user": verified.** `cycle2-mutation-3-user-scoped-panel-lookup.log` shows that test
   failing on both PATCH routes (`failed=2`, 12 others passed). The failure is the intended one: `Vector(<mine>) did not contain element <theirs>`
   (`DashboardLayoutGhostWriteSpec.scala:81`). That is the other user's live panel being dropped, not the ghost assertion. This makes the test a real proof that
   D5 needs the privileged, every-owner panel lookup. Caveat: the log records only "compiling 1 Scala source", not the mutation diff itself. I accept it
   because the failure message is exactly what an owner-scoped lookup produces. See the non-blocking suggestion below.
4. **Preview/apply mismatch (cycle-1 non-blocking):** deliberately deferred to a follow-up, as the cycle-1 report allowed. It was non-blocking, so it does not affect this verdict.

New code in the delta: no unused imports. `HttpRequest` is still used in `DashboardLayoutGhostWriteSpec:21`, and it was removed from the two panel specs that no
longer use it. There are no TODOs, no escape hatches and no inline FQNs.

### Phase 3: UI Review — PASS
The trigger is `frontend/**` (the seam test file). The frontend is unchanged since cycle 1, but I re-ran the flow at af47ebb4a.
- Servers: I started them with `start-servers.sh` on 6888/9795, and `assert-phase.sh servers` printed PASS. Both were fresh processes from this worktree:
  backend pid 1449819 and vite pid 1450374, each 6-8 s old, with cwd in hel-1456. I stopped them afterwards with `kill` on their exact PIDs and parent PIDs.
  Both ports are free now.
- I used an isolated Playwright context (a node script loading the repo's `playwright`), not the shared MCP browser. The throwaway account was
  `hel1456-eval2-1791700088231@example.test`, never the owner's. Every mutating call sent `X-Helio-Requested-With: 1`.
- API, with text panels Keeper (A) and Victim (B):
  - `DELETE /api/panels/B` returned 204, and B was absent from lg/md/sm/xs.
  - I then created Newcomer (C). Its y equalled A's bottom on all 4 breakpoints, so no gap was left.
- UI delete of Newcomer at 1440, keyboard only: focus "Newcomer panel actions" and press Enter, then the "Delete" menuitem and Enter, then "Confirm" and Enter. The
  "Panel deleted." status toast appeared. The only mutation the client sent was `DELETE /api/panels/<C>`, and the stored layout then held no C item in any breakpoint.
  There were 0 console errors and 0 page errors.
- Breakpoints 1440/1100/768/375 rendered without breakage. Screenshots are in `.concertino/runs/HEL-1456/evidence/evaluator-2-ui/`
  (`after-ui-delete-{1440,1100,768,375}.png`, `before-ui-delete-1440.png`). I wrote them directly into the durable run evidence dir, not the worktree. They support
  only "renders, no breakage", and no claim here depends on mtime.
- Cleanup was by exact id:
  - My first script run crashed on an ambiguous toast locator after the API checks. I deleted its leftover dashboard `86c0c8e0-a794-4472-bfbb-139f52f0b0c8`
    (204) on the re-run.
  - I deleted the second run's dashboard `3639bff0-fd42-4a98-a2dd-792ff268925a` (204).
  - The throwaway user row remains, because there is no user-delete endpoint.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Before merge, file the preview/apply divergence follow-up. `PatchSetPreviewProjection.scala:214-218` still claims parity with apply. Link the ticket from
  the PR body, so the deferral is traceable rather than implied.
- `PatchSetUndoConflictCheck.scala:128-132`: `onLive(live.layout)` round-trips `liveDashboard.layout` from domain to response and back to domain.
  `LayoutPolicy.onlyPanels(liveDashboard.layout, panelIds)` would do the same thing directly. This is cosmetic.
- When a mutation log is recorded, include the mutation diff (or `git diff` output) at the top of the log, so the log identifies its own mutation.
