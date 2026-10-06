## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD b2a0d80885ba15069e19f9982de199db309f2432 (worktree unmodified apart from the untracked change dir).

### What I verified (with evidence)

- **Source file shape** (`backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala`, read in full):
  500 lines; one `val routes` with seven `~` alternatives in the order rows (315), filter-capabilities (353),
  distinct-values (370), output-meta (389), history (406), provenance (427), list (444). Every one is `GET` and contains
  a literal `aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)`.
  The design's D3 order statement is correct.
- **Constructor call sites**: production `ApiRoutes.scala:817` (inside `authDirectives.optionalAuthenticate { userOpt => ... }`,
  so a new instance per request). Direct spec construction: `PublicDashboardRoutesSpec`, `OutputHistoryPublicRoutesSpec`,
  `OutputHistoryPayloadPublicRoutesSpec`, `PublicProvenanceRoutesSpec`, `PublicRouteOwnerIdLeakSpec`,
  `ShareTokenPublicAccessSpec`, **and `OutputHistoryQueryCountSpec`** (design names six; there are seven). D1 keeping the
  constructor unchanged means this does not matter for compilation.
- **Marshalling/implicits**: `ServiceResponse.run[A](...)(success: A => ToResponseMarshallable)` resolves the marshaller
  at the call site, so each module needs `JsonProtocols` in scope. `outputFilterCapabilitiesResponseFrom` and
  `outputDistinctValuesResponseFrom` come from `api/protocols/pipelines/OutputProtocol.scala:124,129`. With the plan's
  `Directives with JsonProtocols` mixin and an implicit `ActorSystem`, compile time catches any drift. No issue.
- **Quality script** (`scripts/check-scala-quality.mjs`): only the inline-FQN rule is hard. The 250-line limit is a soft
  warning. New files must import rather than inline FQNs.
- **Source-scanning test guards**: I grepped `backend/src/test` for specs that walk `src/main/scala`. The relevant one is
  below. `RouteTestBaseGuardSpec`, `CredentialSurfaceEnumerationSpec`, `ShareTokenGenerationSpec` and
  `SchemaFieldStructuralGuardSpec` are not affected by new files in `api/routes/dashboards`.

### Blocking finding: the plan cannot keep its own "zero test diff" invariant

`backend/src/test/scala/com/helio/api/http/ExistenceNotLeakedRoutesSpec.scala:315-321` ("name every source file that
calls a shared access helper in at least one table row") walks `src/main/scala`. It collects every file whose code
lines match `\b(requireOwnerOnly|requireAccess|authorizeResourceWithSharing|authorizeResource)\(`
(`filesCallingAccessHelpers`, lines 478-486) and asserts that each such **file name** appears in some `Row.sites`. The
public routes' rows (lines 388-393) all name `Set("PublicDashboardRoutes.scala")`.

I ran a Python replication of `filesCallingAccessHelpers` on the current tree. It returns
`['AutoLayoutService.scala', 'DashboardContentsService.scala', 'DashboardService.scala', 'OutputService.scala',
'PanelService.scala', 'PatchSetApplyResolvers.scala', 'PermissionService.scala', 'PipelinePermissionService.scala',
'PublicDashboardRoutes.scala', 'ShareTokenService.scala']`, so `PublicDashboardRoutes.scala` is detected today.

D4 explicitly requires each route to keep its literal `authorizeResourceWithSharing(...)` call and move into
`PublicPanelListRoutes.scala`, `PublicPanelRowsRoutes.scala`, `PublicPanelOutputMetaRoutes.scala` and
`PublicPanelHistoryRoutes.scala`. None of these names is in any `Row.sites`, so this test **will fail** after the split.
The plan rules out the only test-side fixes:
- Adding the new file names to `sites` edits a test source. That breaks proposal.md ("no test file edited"), D1
  ("forces test edits, which the AC forbids") and D6/task 3.3 (`git diff -- backend/src/test` must be empty).
- History has **no row at all** in the table. It is covered today only because it shares a file with the other routes.
  Honest coverage for `PublicPanelHistoryRoutes.scala` would need a new `Row`. Each row generates a test case
  (`rows.foreach { ... in { ... } }`, line 212), so the test count would change and break the AC directly.
  Attaching the history file to an unrelated row would satisfy the guard without the coverage it claims.

So the plan as written either fails the suite or forces a test edit it has forbidden itself. The design never mentions
this guard. D6's test run would surface the failure, but only after implementation, and the executor's only "fix" would
be a forbidden one.

### Other checks against the key questions

- **D3 order**: holds as specified. Per-route fragments composed in the original order inside the unchanged
  `pathPrefix("dashboards" / Segment / "panels")` keep the alternative order and the rejection accumulation order.
  The fragments are invoked inside the `dashboardId =>` lambda, i.e. per request, so declaring module vals after
  `val routes` would not cause an initialization-order NPE. Declaring them first is still cleaner.
- **Optional-auth / D8 coverage**: `ApiRoutes.scala:817`'s wiring is unchanged (D1). The specs that exercise
  `userOpt = None`, share tokens, the owner-id leak and the public history summary (`OutputHistoryPublicRoutesSpec`,
  `OutputHistoryPayloadPublicRoutesSpec`) all build the entry point, so they keep exercising every module through it.
  This is adequate.
- **Instance sharing**: today `outputControlsValidator` is one per entry-point instance (one per request). The plan's
  per-instance module construction keeps that cardinality. A single shared `PublicPanelOutputResolver` passed down
  matches the existing single `resolvePanelOutput`. No behavioural risk.
- **D5 failability**: the skeleton listing covers directives, parameter lists, ACL args, `ServiceResponse.run`
  targets and mappers. It does **not** cover in-body logic such as `if (offsetRaw < 0)`,
  `math.min(limitRaw, Page.MaxLimit)`, the `parseSortParam`/`parseFilterParam` match, `OutputHistoryQueryParsing.parse`,
  or the resolver bodies themselves. D4 claims those move verbatim, but no evidence step proves it. The design also
  never shows that the extractor can go red: a scratchpad extractor that misses a reorder would still yield an
  "expected: empty" diff.
- **D6**: total plus per-suite counts and an empty `backend/src/test` diff can go red. Combined with the guard above,
  D6 would correctly catch the defect. The defect is in the design, not in D6.

### Verdict: REFUTE

### Change Requests

1. **Resolve the `ExistenceNotLeakedRoutesSpec` access-helper-file guard (lines 315-321, 388-393) explicitly in
   design.md, and make D1/D2/D4/D6 and proposal.md consistent with the resolution.** Recommended resolution, which
   keeps zero test diff and keeps the guard truthful: every `aclDirective.authorizeResourceWithSharing(...)` call stays
   in `PublicDashboardRoutes.scala`. The entry point keeps the directive tree (paths, params, validation, ACL gate,
   `ServiceResponse.run`). The concern modules own the resolvers (`resolveRows`, `resolveFilterCapabilities`,
   `resolveDistinctValues`, `resolveOutputMeta`, `resolveProvenance`, `resolveHistory`, `resolveDataAsOf`,
   `resolveOrphanedControlIds`, the shared `resolvePanelOutput`) plus the validator. Lines 313-499 are about 187 lines,
   so the entry file still lands near the 250 soft budget, which is only a warning. Re-state the D3/D5 composition
   in those terms.
   If instead the planner keeps directives in the modules, the design must name the exact `ExistenceNotLeakedRoutesSpec`
   edit, state why editing `sites` is not an "assertion change", and solve history coverage without adding a `Row`
   (which changes the test count) or attaching it to an unrelated row. I do not see a clean way to do that, which is
   why I recommend the first option.
   Either way, add a task that runs
   `ExistenceNotLeakedRoutesSpec` (or a re-run of the `filesCallingAccessHelpers` scan) against the post-split tree.
2. **Make D5 provably failable and cover the moved bodies.**
   (a) Add a verbatim-move check: a block-by-block diff of each moved resolver/route body against the original with
   indentation normalized, or `git diff --color-moved=dimmed-zebra --color-moved-ws=allow-indentation-change` with the
   residual non-moved lines listed. Record it in `route-tree-evidence.md`. Every non-verbatim line must be listed and
   justified (only "above/below" wording per D4, plus the new class/def scaffolding).
   (b) Record one red run of the skeleton extractor in `route-tree-evidence.md`. For example, feed it a scratch copy
   with two fragments swapped, or one `parameters(...)` argument dropped, and show a non-empty diff, so the "empty
   diff" result is known to be capable of failing.
3. **Correct the D2/Context spec enumeration** to include `OutputHistoryQueryCountSpec`
   (`backend/src/test/scala/com/helio/api/routes/pipelines/OutputHistoryQueryCountSpec.scala:101`). It is a DB
   query-count spec, so it is exactly the one that would catch an accidental extra lookup if a resolver were not moved
   verbatim. List it among the D6 related suites whose per-suite counts are recorded.

### Non-blocking notes

- Spinoff candidate (do not fix here): `ExistenceNotLeakedRoutesSpec` has no row for
  `GET /api/dashboards/{id}/panels/:panelId/history`. The public history route's foreign-vs-absent 404 parity is not
  probed by the table. Under refactor discipline this should be filed as a follow-up.
- If the list-module code moves, the comment at original line 59 ("see this class's own doc comment") and the class
  doc (lines 22-39, which is really about the list route's `dataAsOf`) refer to the wrong class. Under CR1's
  recommended shape the class doc stays with the entry point, which avoids most of this. Otherwise the planner should
  decide whether the doc moves with `resolveDataAsOf`.
