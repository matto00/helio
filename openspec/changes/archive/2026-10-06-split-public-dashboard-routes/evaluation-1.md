## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `f60b0346724b0788e1378f6b00cd6591bd4e01a8`. Diff base, resolved live: `b2a0d80885ba15069e19f9982de199db309f2432`.

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1 (split by concern, composed by the existing entry point): five `final class` resolvers in
  `com.helio.api.routes.dashboards`. `PublicDashboardRoutes` keeps its name, package, constructor and defaults (D1),
  and builds the modules before `val routes`.
- AC2 (same route tree, same test count, no assertion changes): I checked this myself (see Phase 2).
  `git diff b2a0d8088...HEAD -- backend/src/test` is empty, and the full suite has 6039 tests, the same as the baseline.
- AC3 (optional-auth and D8 summary-only coverage): no test was changed, and every related suite passes in my full run.
- AC4 (refactor discipline): there are no behaviour edits. Two spinoffs are written down in design.md Planner Notes and
  were not fixed here.
- Tasks 1.1–3.3 are all ticked and match the diff. README "Holds" is updated. The change is scoped to
  `api/routes/dashboards/` and the change dir.
- CONSTRAINTS:
  - C1 holds. All 7 `authorizeResourceWithSharing(` code call sites are in `PublicDashboardRoutes.scala` (lines
    85/103/120/139/159/177/201), the same count as the 7 at b2a0d8088. Running
    `grep -E "(requireOwnerOnly|requireAccess|authorizeResource|authorizeResourceWithSharing)\("` over the five new
    files gives 0 hits each. The only mention in a new file is the doc comment at `PublicPanelRowsResolver.scala:30`,
    which has no `(`. `ExistenceNotLeakedRoutesSpec.codeLines` also strips `*`-prefixed lines, so that comment cannot
    trip the guard. No module wraps an ACL call.
  - C2 holds. There is no test diff, and the totals match the baseline (below).

### Phase 2: Code Review — PASS
Issues: none blocking.

**Gates (my own runs):**
- `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull` in `WORKTREE_PATH` at f60b03467 exited 0.
  Result: `Total number of tests run: 6039`, `Suites: completed 428, aborted 0`, `Tests: succeeded 6039, failed 0`.
  That equals the baseline line in the executor's `hel1291-baseline-testfull.log` (6039/428). Log:
  scratchpad `hel1291-eval-testfull.log`.
- `node scripts/check-scala-quality.mjs` is clean. It reports no inline-FQN violations and no size warnings for any
  touched main file. Sizes: entry point 218 lines (was 500); resolvers 41/44/55/107/148, all under the 250 soft budget.
- No frontend files changed, so the npm gates do not apply.

**Independent check of the executor's evidence (treated as claims):**
- **D5a skeleton normalisation hides nothing.** I did not use the executor's extractor. I took a raw, un-normalised
  `diff` of the `val routes` region to EOF, b2a0d8088 against HEAD. It shows exactly seven changed hunks:
  - the six receiver renames: `rows.resolveRows`, `rows.resolveFilterCapabilities`, `rows.resolveDistinctValues`,
    `outputMeta.resolveOutputMeta`, `history.resolveHistory`, `outputMeta.resolveProvenance`;
  - the `resultF` body (29 lines, comments included) collapsed to `val resultF = panelList.panelList(dashboardId, page, access)`.

  Nothing else changed in that region: no path, `parameters(...)` argument, ACL argument, mapper, `onSuccess`/`complete`
  wrapper, or `~` order. So the receiver-rename and RESULTF normalisations hid no real difference.
- **Verbatim moves confirmed.** My script (scratchpad `hel1291-eval-verbatim.py`) extracts each unit (doc comment +
  def/val + body) from b2a0d8088 and from its new home. It then normalises only leading whitespace, `private `, and
  `panelOutput.resolvePanelOutput(` → `resolvePanelOutput(`, and diffs the two.
  - Changed lines are 0 for `resolveDataAsOf`, `resolveOrphanedControlIds`, `resolveFilterCapabilities`,
    `resolvePanelOutput`, `resolveProvenance` and `resolveHistory` (20 lines), and for the panel-list `resultF` body
    (29 lines, after stripping `val resultF = `).
  - The remaining units differ only in D4 positional comment words:
    - `outputControlsValidator`: 2, "this class's" → `` `PublicDashboardRoutes`'s ``
    - `resolveRows`: 6, "above"/"below" wording
    - `resolveDistinctValues`: 4, "above" dropped
    - `resolveOutputMeta`: 2, "above" dropped

  No code token changed in any moved body. That covers the ownerView rule, both `accessAlreadyGranted = true`
  lookups, all degrade/404 branches and the D8 `OutputHistoryResponses.public` projection.
- Wiring: every module gets the same `system.executionContext` instance (as an implicit `ExecutionContext`). Modules
  are built once per entry-point instance, so validator cardinality is unchanged. They are declared before
  `val routes`, so there is no initialisation-order null. The new private val names (`rows`, `history`, `outputMeta`,
  `panelList`, `panelOutput`) appear in the route region only at the changed call sites. The old `.map { rows => ... }`
  lambda moved out, so nothing is shadowed.
- DRY, modularity, type safety, error handling: unchanged by construction (pure move). No dead imports in the new
  files: I checked each import is referenced. No TODO/FIXME, and no over-engineering.
- Tests: none added, as expected for a behaviour-preserving split. The existing public-route specs exercise every moved
  path, and `OutputHistoryQueryCountSpec` still passes, which guards query counts.

### Phase 3: UI Review — N/A
No trigger paths changed: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

### Overall: PASS

### Non-blocking Suggestions
- `route-tree-evidence.md` D5c lists `"three ... routes below" -> "three ... routes"` as a change. It was not made:
  `PublicPanelOutputResolver.scala:21` still reads "shared by the three new panel-scoped public routes below", and
  "below" is now false because the routes live in `PublicDashboardRoutes`. The evidence overstates rather than hides a
  change, so this does not block. Either correct the evidence line or apply the D4 word fix.
- Two more positional words went stale after the move but were kept:
  - `PublicPanelRowsResolver.scala:41`: "every call site below passes them explicitly". The call sites are in
    `PublicDashboardRoutes`.
  - `PublicPanelRowsResolver.scala:33-34`: "mirrors `resolveDataAsOf`'s own degrade-gracefully convention in
    `PublicPanelListResolver.resolveDataAsOf`" names the method twice.

  Both are cosmetic, and D4 permits but does not require fixing them.
