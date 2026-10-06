## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `f60b0346724b0788e1378f6b00cd6591bd4e01a8`. Diff base, resolved live via `resolve-review-base.sh`: `b2a0d80885ba15069e19f9982de199db309f2432`.
I treated the executor's evidence files and `evaluation-1.md` as claims. Every conclusion below comes from my own scripts and runs.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-public-dashboard-routes/HEL-1291`.
- **Scope:** `git diff --stat b2a0d808...HEAD` shows changes only in:
  - `PublicDashboardRoutes.scala` (500 lines down to 218);
  - five new resolvers in the same package;
  - `dashboards/README.md`;
  - the change dir.

  `git diff b2a0d808...HEAD -- backend/src/test | wc -l` gives `0`, so C2's no-test-edit half holds.
- **AC1 (concern modules composed by the existing entry point):** `PublicDashboardRoutes` keeps its name, package, constructor and defaults (lines 35-44, D1). It builds the five resolvers once per instance, before `val routes` (lines 53-57), so there is no init-order null and the cardinality is unchanged. The resolvers are:
  - `PublicPanelOutputResolver`
  - `PublicPanelListResolver`
  - `PublicPanelRowsResolver`
  - `PublicPanelOutputMetaResolver`
  - `PublicPanelHistoryResolver`
- **AC2a (identical route tree), my own extractor:**
  - Method: take the `val routes` region from the b2a0d808 file and from HEAD. Strip `//` comments, collapse the panel-list `resultF` body to a placeholder, and normalise the four receiver prefixes (`rows.`, `outputMeta.`, `history.`, `panelList.`) after `ServiceResponse.run(`.
  - Result: 154 vs 154 normalised lines and an **empty unified diff**. Every path, method, `parameters(...)` list, ACL argument list, mapper, `onSuccess`/`complete` wrapper and `~` order is unchanged.
- **Verbatim moves, my own block comparison:** I compared each moved unit, whitespace-normalised, with `panelOutput.resolvePanelOutput` mapped back to `resolvePanelOutput`. The units are `resolveRows`, `resolvePanelOutput`, `resolveFilterCapabilities`, `resolveDistinctValues`, `resolveOutputMeta`, `resolveProvenance`, `resolveHistory`, `resolveDataAsOf`, `resolveOrphanedControlIds` and `outputControlsValidator`.
  - All 10 are token-identical to the original. The only diff hits were my extractor running past each class's closing `}` into the next concatenated file.
  - I compared the panel-list body in `PublicPanelListResolver.panelList` (lines 84-105) with the original `val resultF` (orig lines 468-490) by eye. It is identical, including `accessAlreadyGranted = true` and the `ownerView` rule.
  - A line-multiset check found that every removed line not present in a module is one of: an import, a receiver rename, `private def` → `def`, or a positional comment word ("above"/"below"/"this class's").
- **Implicit drift risk:** the resolvers take `(implicit executionContext: ExecutionContext)`, fed from the entry point's `system.executionContext`, which is the same instance as before. `grep toJson|convertTo|implicit` over the modules finds no JSON-format implicit use, so dropping the `JsonProtocols` mix-in from the moved bodies cannot change resolution. Marshalling stays at the `ServiceResponse.run`/`complete` call sites in the entry point.
- **C1 (ACL calls stay in the entry file):**
  - `grep -rln 'authorizeResourceWithSharing(' backend/src/main/scala` lists `AclDirective.scala` and `PublicDashboardRoutes.scala`, the same set as `git grep` at b2a0d808.
  - The call count in the entry file is 7, unchanged from 7. No resolver calls or wraps it.
- **AC2b / AC3 (tests unchanged and passing, guarantees still covered):**
  - I re-ran the 10 related suites myself with `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt "testOnly ..."`: PublicDashboardRoutes, OutputHistoryPublicRoutes, OutputHistoryPayloadPublicRoutes (D8), PublicProvenanceRoutes, PublicRouteOwnerIdLeak, ShareTokenPublicAccess, OutputHistoryQueryCount, ExistenceNotLeakedRoutes (the access-helper guard), DashboardPanelAcl and PublicPathRlsSmoke.
  - Result: exit 0, `Total number of tests run: 154`, `Suites: completed 10, aborted 0`, `Tests: succeeded 154, failed 0`. That equals the executor's per-suite table summed without ApiRoutesSpec: 23+4+2+5+8+4+3+61+41+3 = 154.
  - Log: scratchpad `hel1291-skeptic-related.log`.
  - I did not re-run the full suite. I rely on the evaluator's pasted, unambiguous `Tests: succeeded 6039, failed 0` / `Suites: completed 428`, which equals the executor's baseline 6039/428. With zero test-source diff, the static test count cannot have changed.
- **Quality gate:** `node scripts/check-scala-quality.mjs` exited 0 ("clean"). None of the touched files is in the size warnings.
- **AC4 (refactor discipline):** no behaviour edits, as shown above. The two spinoffs are recorded in the design.md Planner Notes and are not fixed here: the missing ExistenceNotLeaked row for public `/history`, and a stale comment.
- **UI:** no `frontend/**` change, so step 4 does not apply.

### Verdict: CONFIRM

### Non-blocking notes

- Positional words in comments are now stale because the routes moved to another file. They are cosmetic, and D4 permits but does not require fixing them:
  - `PublicPanelOutputResolver.scala:21` says "routes below".
  - `PublicPanelRowsResolver.scala:41` says "every call site below".
- `route-tree-evidence.md` D5c claims the "below" fix at `PublicPanelOutputResolver.scala:21` was made, but it was not. The evidence overstates rather than hides a change. The evaluator noted this too.
- `private def` → `def` widens the resolver methods to public within final classes. This is required for cross-class delegation and is harmless.
