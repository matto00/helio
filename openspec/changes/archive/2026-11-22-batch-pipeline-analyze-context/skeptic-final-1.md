## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9da94e47fe4ce68070c3ff21551ed732dee8396a` against the live-resolved base `73b32e562428aab46e98c4c378bdd13869219ac6`
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/batch-pipeline-analyze-context/HEL-1625`.

### What I verified (with evidence)

- **Goldens untouched (C15).** `git diff --stat $BASE...HEAD -- helio-mcp/src/__golden__` is empty. Both
  `workspaceContext.full.json` and `workspaceContext.concise.json` are present and unchanged.
- **/analyze unchanged.** I read the full `backend/src/main` diff.
  - `PipelineAnalyzeReads.analyze` now calls `PipelineAnalyzeProjection.fetch`/`project`. The resolvers are the same
    ones it used before: roots `findByIdOwned(_, user)`, upsert `findByIdOwned(_, AuthenticatedUser(ownerId))`,
    secondaries `findByIdInternal`.
  - `UpsertTargetAnalysis.problems(..., repo)` now delegates to `resolve(DataSourceId(id)).map(classify(id, _))`,
    which is what `UpsertTargetCheck.checkExisting` already did (`UpsertTargetCheck.scala:36-39`).
  - `nonOwnerValidity`/`nonOwnerValidationError` were moved without change, and `analyzeConcise` calls the moved copy.
  - No existing test file changed apart from the additive `wrapPool` hook in `TwoUserRlsApiFixture` (default = old
    wiring).
  - I re-ran the existing analyze specs and they are green (see below).
- **Backend gates, re-run fresh** (`sbt -J-Xmx3g`, `nice -n 19`, `DATABASE_URL` set to helio_hel1625,
  `ANTHROPIC_API_KEY` empty). Specs run: PipelineContextAnalyzeRoutesSpec, PipelineContextAnalyzeQueryCountSpec,
  PipelineContextAnalyzeUndecodableRowSpec, PipelineAnalyzeUpsertGranteeGuardSpec, PipelineAnalyzeRoutesSpec,
  StepConfigInvalidRoutesSpec, PipelineContextDetailsRoutesSpec, PipelineAnalyzeCanRunRoutesSpec,
  Hel1661GranteeAnalyzeVerdictSpec and Hel1799GranteeConciseAnalyzeSpec.
  - Result: `Suites: completed 10, aborted 0` / `Tests: succeeded 76, failed 0`, exit 0. Every suite name appears in
    the output.
  - Statement count: `statements at 10 pipelines: app=5 privileged=4; at 200: app=5 privileged=4`.
  - Output: `/home/matt/Development/helio/.concertino/scratch/HEL-1625/skeptic-final-sbt.txt`.
- **MCP gates, re-run fresh.**
  - `npx jest --maxWorkers=3 helio-mcp/`: 68 suites, 621 tests, all pass, exit 0. This includes
    contextRequestBudget, contextAnalyzeSeam and helioApi.contextAnalyze. Output:
    `/home/matt/Development/helio/.concertino/scratch/HEL-1625/skeptic-final-jest.txt`.
  - `npm run typecheck` in helio-mcp: exit 0.
- **AC1: the request-count test pins a constant-in-P bound, plus a 200-pipeline fixture under 120.**
  - `contextRequestBudget.test.ts` asserts 55 and 200 pipelines with `placedBelow` held fixed give
    `large.total === small.total === 31`.
  - At 200 pipelines, the only `/analyze` sent is for `p-${ANALYZE_FAILS_INDEX}`.
  - With natural placements, 200 pipelines stay `< 120`.
  - The 404 mode, which is the pre-change shape, goes above 120.
  - Exact totals are pinned: 31, 85, 141 and the per-mode stderr lines.
  - `context.ts` asks `analyzePipeline` only for a pipeline the batch is missing (`contextAnalyze?.get(id) ?? await
    api.analyzePipeline(id)`), so the bound is 8 + 2 + Op + D + A by construction.
- **AC2: golden, seam schema guards and `TwoUserRlsApiFixture` isolation all follow the HEL-1619 pattern.**
  - **Golden:** golden equality holds in every analyze-batch mode (serve, 404, 500, missing-one, malformed, both 404).
  - **Seam guards:** both halves validate against the same committed schema
    `schemas/pipelines/pipeline-context-analyze-response.schema.json` (`additionalProperties: false` at every level).
    The backend half checks the real body in `PipelineContextAnalyzeRoutesSpec`. The MCP half checks the fixture body
    in `contextAnalyzeSeam.test.ts`. Each half includes rename mutations that prove the guard can fail, and the
    fixture's batch items are derived from its own `/analyze` bodies.
  - **Isolation:** runs on a `helio_app_test` pool, which is `NOBYPASSRLS` (`TwoUserRlsApiFixture.scala:130-131`).
    User A owns the pipeline, B holds editor and C holds viewer on the shared pipeline.
    - No A pipeline or step id appears in B's or C's body.
    - B's own item equals B's own `/analyze`. C's items are empty.
    - B's and C's per-pipeline `/analyze` of A's pipeline still returns A's steps.
- **Ticket context: parity with the per-pipeline route.** The rich fixture covers:
  - multi-root and branched pipelines;
  - disabled steps;
  - an invalid config;
  - join and lookup steps reading a secondary source;
  - upsert targets that are ok, missing, foreign or a csv;
  - warnings;
  - a foreign root;
  - a pipeline with zero steps.

  Every item deep-equals its `/analyze` `steps`/`warnings`, with non-vacuity asserts (warnings > 0, at least 4
  validation errors).
- **Ticket context: statement count constant in P, and measured.** `large shouldBe small` plus a `<= 16` cap. The
  measured value is 9 at 10 and at 200 pipelines, which matches measurements.md. In the batch, every per-pipeline
  resolver is map-backed (`PipelineContextAnalyzeReads.scala`), so no statement runs per pipeline.
- **Red evidence (C12).**
  - The red commit `bf481b1fe` contains the backend specs and `red-backend-routes.txt`, `red-guard-mutation.txt`,
    `red-backend-count.txt` and `red-mcp.txt`. It contains no implementation; `PipelineContextAnalyzeReads` and the
    route arrive in `7395e0409`.
  - The guard-mutation and parity-mutation outputs show real assertion failures naming the expected cause.
  - The count red is only a compile failure. The 10-vs-200 equality can still fail under an N+1 resolver, but there is
    no recorded mutation for it.
  - The MCP red deviation (the tests could not be committed red because the hook runs jest) is disclosed in the commit
    message and in measurements.md. `red-mcp.txt` records 13 failures. Those failures follow from the pre-change code,
    which never calls `context-analyze`, so the exact-31 assertions cannot pass on it.
- **Contract.** There is no OpenAPI or doc listing for `context-details` outside the schema and the README, so the new
  schema plus the README budget update follow the HEL-1619 precedent. No migration.
- **UI.** No `frontend/**` change, so step 4 was skipped. I did not start a live server: the route-tree specs run the
  real `ApiRoutes`, including mount order and 401.

### Verdict: CONFIRM

### Non-blocking notes

- `DataSourceRepository.findByIdsOwned`'s doc comment says "the column compares as uuid". `data_sources.id` is `TEXT`
  (`V4__data_sources_and_types.sql:2`, confirmed live: `information_schema` reports `text`).
  - The batch resolver also normalizes each raw id with `UUID.fromString(raw).toString` (lower-case, and Java's lenient
    parse). The single read compares the exact text, so in principle a non-canonical stored reference (for example an
    upper-cased id) would be "found" by the batch and "not found" by `/analyze`. Design D3 says "raw id".
  - This is unreachable through the API today: ids are server-generated lower-case UUIDs, and step save requires the
    exact-text lookup to succeed (`StepReferenceChecks.secondarySourceOwnershipF`, `upsertOwnershipCheck`).
  - Worth fixing the comment, and keying on the raw id the single read uses, in a follow-up.
- If a batch item is present but has no `steps` array, `mapAnalyzedSteps` throws and produces `stepsError` instead of
  falling back to `analyzePipeline`. The spec only covers a missing `items` array, so this is not a divergence from the
  spec. Hardening it is optional.
- The count spec's red is a compile failure only. Recording an N+1 mutation (a per-pipeline `findByIdOwned` in the
  resolver) would make it self-evidently failable.
- PR: note the hosted MCP needs `deploy-mcp.sh` (not run, per C8), and that `context.ts` is now 794 lines.
