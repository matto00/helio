## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 73b32e562428aab46e98c4c378bdd13869219ac6 (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Owner-only list (driver claim): CONFIRMED.** `PipelineRepository.listSummaries` (PipelineRepository.scala:695-716)
  filters `ownerId === ownerUuid` on both the tag and no-tag branch; `GET /api/pipelines` calls it
  (PipelineRoutes.scala:32), and so does `PipelineService.contextStepsForOwner` (PipelineService.scala:240-250), which
  backs context-details. `rowToSummary` populates `ownerId` (PipelineRepository.scala:297), so D5's per-summary
  `ownerId == caller` assertion is implementable with no extra read.
- **Full analyze in the MCP (driver claim): CONFIRMED.** helio-mcp/src/context.ts:613 calls
  `api.analyzePipeline(summary.id)` with no concise argument; it reads `warnings[].stepId/code/message` and
  `steps[].position/type/outputSchema[].name/validationError`, and `concise` only switches the MCP projection.
- **Analyze inputs (D3/D4 claim): read `PipelineAnalyzeReads.analyze` in full (PipelineAnalyzeReads.scala:39-188).**
  steps/warnings depend on `listByPipelineInternal`, `listRootDataSourceIdsInternal`, `rootIdsOf`, roots through
  `findByIdOwned(dsId, user)` (line 78), secondaries through `resolveSecondarySourceSchemas(..., findByIdInternal)`
  (line 81; the resolver is already a parameter, PipelineStepOwnership.scala:88-95), upsert problems through
  `UpsertTargetAnalysis.problems(..., AuthenticatedUser(pipelineOwnerId), repo)` (lines 31-36, 82), and
  `ownerRootSchemas` (None for the owner, line 227). The design's list is accurate.
- **Batch helpers reproduce single-read ordering/filters.** `listByPipelineInternalBatch` applies the same
  `executionOrder` per pipeline group (PipelineStepRepository.scala:376-385 vs 337-340); `rootIdsOfBatch` has the same
  `rootId.isDefined` filter (1223-1236 vs 1206-1212); `listRootDataSourceIdsInternalBatch` sorts by
  `(pipelineId, position)` and `groupBy` preserves order within a group, same per-pipeline order as the single read's
  `sortBy(position)` (PipelineRepository.scala:131-138 vs 162-177). All system context, same as the single reads.
- **Single by-id filters to copy (D4).** `findByIdOwned` = user context + `id === id && ownerId === caller`
  (DataSourceRepository.scala:180-185); `findByIdInternal` = system context + `id === id` (156-158). `data_sources.id`
  is TEXT, so an `inSet` over raw (even malformed) ids cannot fail differently from the single read.
- **Upsert check scoping.** `UpsertTargetCheck.checkExisting` resolves the target with the PIPELINE OWNER
  (UpsertTargetCheck.scala:34-39), whereas roots resolve with the CALLER. Equal only when caller == owner.
- **Existing grantee coverage of upsert targets: NONE.** `Hel1661GranteeAnalyzeVerdictSpec` covers roots and step
  validity, not `upsertsource`. `PipelineAnalyzeUpsertSourceSpec` is owner-only (line 106, `service.analyze(pid,
  owner)`). A grep for test files mentioning analyze + grant/editor/viewer + upsert finds only
  PipelineRunServiceSpec, AutoRunTriggerServiceSpec and ExistenceNotLeakedRoutesSpec, and none of those analyzes an
  upsert step as a grantee.
- **Infra claims.** `CountingDataSource` is a shared test helper (backend/src/test/scala/com/helio/testsupport/
  CountingDataSource.scala), and `TwoUserRlsApiFixture` exists. `pipeline-analyze-response.schema.json` has `$id`
  plus `$defs.AnalyzeStep`/`AnalyzeWarning` for D8's `$ref`. The HEL-1619 pattern (route + protocol + schema + seam
  test + fixture + live probe, no OpenAPI file) matches 83cbfc022's stat.
- **Request budget arithmetic.** The current test pins 8 + 1 + 55 + 19 + 1 = 84 (contextRequestBudget.test.ts). The
  new bound is 8 + 2 + Op + D + A.

### Verdict: REFUTE

### Change Requests

1. **D3 conflates two different "owned" scopes into one `ownedSource` resolver, and no existing test would catch the
   resulting `/analyze` regression.** In `analyze`, roots resolve as the caller (`findByIdOwned(dsId, user)`,
   PipelineAnalyzeReads.scala:78), but upsert targets resolve as the pipeline owner
   (`AuthenticatedUser(pipeline.ownerId)`, lines 31-36/82). D3 lists one `ownedSource` resolver used for both. An
   implementer who wires it as `findByIdOwned(_, user)` makes every editor/viewer grantee's `/analyze` report
   `Data source not found: <id>` on a valid owner-owned upsert target. That breaks the proposal's "No change to
   `GET /api/pipelines/:id/analyze`" non-goal. It is also invisible to every planned check: 4.2's parity is
   owner-only (caller == owner), and the "existing grantee specs stay green" argument does not hold because no
   existing spec analyzes an `upsertsource` step as a grantee. Required revisions:
   (a) design.md D3: name two distinct resolvers, roots-as-caller and upsert-targets-as-pipeline-owner, and state
   which repo call `analyze` passes for each. (The batch may pass the same map for both only because of D5.)
   (b) tasks.md 4.3 (or a new 4.x): A's shared pipeline must include an `upsertsource` step whose existing-source
   target is an A-owned dataset. Assert that B's (editor) and C's (viewer) `/analyze` return no `validationError` on
   that step. Write the test before the refactor, label it a guard (it passes pre-change), and record a mutation
   (resolver wired to the caller) that turns it red.

2. **The MODIFIED "55-pipeline fixture" scenario is now false and cannot be tested as written.**
   specs/mcp-workspace-context-request-budget/spec.md keeps HEL-1619's THEN, "the same fixture on the pre-change code
   sends more than 120". In this change, "pre-change code" is post-HEL-1619 code, which sends 84 requests at 55
   pipelines (contextRequestBudget.test.ts pins 84). D9's emulation of the pre-change shape (analyze-batch 404)
   gives 8 + 2 + 55 + 19 + 1 = 85, also under 120. Required revision: rewrite that scenario. For example: at most
   8 + 2 + Op + D + A requests (a pinned exact number), and with the analyze batch 404 it sends exactly the HEL-1619
   count plus one. Or drop the scenario and keep "Constant in P" and "200-pipeline fixture", whose "pre-change
   sends > 120" does hold (8 + 2 + 200 + Op + D).

### Non-blocking notes

- **Step order on the parity test.** `executionOrder` orders siblings with a stable `sortBy(position)` over SQL row
  order, which is unordered (PipelineStepRepository.scala:1195-1196, 1386-1401). The single read
  (`pipeline_id = x`) and the batch (`pipeline_id IN (...)`) can return equal-position parentless siblings in
  different orders if such ties exist. Before relying on multi-root deep-equality, confirm root-level positions are
  unique across roots; otherwise the parity test can flake on a plan change. This nondeterminism already exists
  between two calls of the single route; it is not introduced here.
- **Failure modes the batch does not share.** Per-pipeline `/analyze` can also fail in cost gathering,
  `findGrantRole`, the drift baseline or `primaryOwnerViewF`, and the batch never runs those. On a live backend the
  batch can therefore return steps where the old path returned `stepsError`. That is fine (and arguably better), but
  "byte-identical on every path" holds only for the fixture. Say so in design.md Risks rather than leave it implied.
- **Statement-count wording.** If `findByIdsOwned`/`findByIdsInternal` short-circuit on an empty id set (as the
  existing `*Batch` reads do), the count depends on whether ANY secondary or upsert target exists (0 vs at least 1),
  not on P. The spec says "does not depend on the number of pipelines, steps or roots". Keep the 10-vs-200 fixtures
  same-shaped, as 4.4 already implies.
- **Raw upsert target id.** `checkExisting` looks up `DataSourceId(id)` untrimmed (the `.trim.nonEmpty` check is
  only a guard), so the map-backed resolver must key on the raw id too.
- **Fake batch in "serve" mode.** The fake batch must omit `ANALYZE_FAILS_INDEX`'s pipeline (mirroring D6), or the
  golden diverges. Serve mode will then emit one "absent" stderr line. Make the expected stderr per mode explicit in
  task 2.3/4.5 so a "no stderr in serve mode" assertion is not written by mistake.
