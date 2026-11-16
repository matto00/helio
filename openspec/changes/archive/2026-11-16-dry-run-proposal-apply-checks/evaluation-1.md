## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `73e49f8a75c990bc7ea8d18fc6283e199525d240` against the live-resolved base `fd7064f7d700e49a2f7dfc1f6a244aab02048fd2`
(9 commits, 70d7df8b4..73e49f8a7). The working tree was clean.

### Gate runs (fresh, by the evaluator)
- `nice -n 19 sbt -J-Xmx3g testFull` (backend): ScalaTest summary `Total number of tests run: 9525`, `Suites: completed 691, aborted 0`,
  `Tests: succeeded 9525, failed 0, canceled 5`, `All tests passed.`, hel1468-guard `failed=0 aborted=0 unreadable=0`, exit 0.
- Root `npx jest --maxWorkers=3` (includes helio-mcp): 66 suites, 579 tests passed. `helio-mcp` typecheck clean.
- `npm run lint`: clean. `npm run format:check`: clean. `npm run check:schemas`: in sync (143 schemas; AssistantProposalToolSchemas in
  sync with schemas/, 14 surfaces). `npm run check:scala-quality`: clean (soft warnings only). `npm run check:openspec`: clean.
- Frontend gates (`npm test`'s frontend half, `npm --prefix frontend run build`) not run: no file under `frontend/**` changed.

### Phase 1: Spec Review — FAIL
- AC1 (a test red on the old code: missing column rejected at propose): met. `PipelineProposalServiceValidateSpec`, red evidence
  `evidence/red-1.1.txt`, green in my testFull run. Combined and assistant-executor versions exist too (red-1.2, red-1.3).
- AC2 (parity): met, through shared functions plus a mutation proof, not through the corpus alone. `ProposalDryRunParitySpec` has 21
  entries in 4 families. Every entry runs the real `PipelineService`, `PipelineRunService`, `PanelService`, `DashboardService` and
  `PatchSetApplyService` against a private embedded Postgres, with a real local HTTP stub for the rest roots. Caveat (non-blocking,
  see suggestions): `apply` now calls the same dry run first, so a dry run that rejects too much would show up as "both reject" and
  pass. Only the accept entries and the mutation evidence guard against that. The mutation evidence
  (`evidence/mutation-4.1-shared-functions.txt`) shows breaking `outputNodeSchemas` / `outputMappingProblem` turns the dry-run tests
  AND `DisabledStepOutputColumnRoutesSpec` red. That spec runs `POST /api/pipelines`, i.e. apply's `createTransactional`, and does not
  go through the dry run, so this is the "same function on both paths" proof the AC allows.
- AC3 (assistant loop, is_error naming the columns, retry in the same turn): met. `AssistantColumnLoopSpec` uses a scripted
  `ClaudeTransport` (no live call). Hop 1 is `is_error` naming `display_name` / "Available columns:" / `owner_id`. Hop 2 is a lookup
  and is captured. `proposeValidationFailures == 1`.
- AC4 (live Sleeper check): **UNMET LIVE.** It is proven only by the scripted replay in `AssistantColumnLoopSpec`, per the
  driver's no-live-calls directive. It must be reported as unmet-live in the PR, not as satisfied.
- Disabled-step apply behaviour change: intended (design D1.7), stated, and tested. `DisabledStepOutputColumnRoutesSpec` has a
  disabled-accept test plus an enabled GUARD (red evidence `red-2.6-disabled-step.txt`), and the corpus has two disabled-step entries.
- Patch-set apply behaviour change (a panel-update controls failure is now a resolve-time 400 instead of a mid-set reported
  failure, `PatchSetApplyServiceSpec`): consistent with D3 and stated in the inventory. Not a regression.
- Scope: backend and helio-mcp only, with no frontend change (verified: `git diff --stat base...HEAD -- frontend/` is empty). No
  change to `infrastructure/ai/` (ClaudeClient/ClaudeProtocol/ClaudeModels) or to `services/assistant/` main code. No MCP tool
  `inputSchema` or description changed, and `AssistantProposalToolSchemas` is in sync per the drift check (C8 honoured).
- C10 honoured: `ProposalDryRunRestSchemaSpec` records the composed request (path plus raw query after templating) from a real
  local stub for both the dry run and `createRest`. Mutation 1 (drop `parameters`) went red.
- C11 honoured: `RestApiConnectorDriver.inferSchemaForConnector` issues the composed request through `issueAndParse`
  (`guardedPoolSettings`, HEL-879). `composeRequest` is a pure move of `buildResolvedRequest`'s post-resolve body.
- **C12 partially violated (see CR1).** It uses the same limiter instance: `ApiRoutes.sourceFetchLimiter` is shared by
  `sourceFetchRateLimitDirective` and `SourceFetchBudget`. There is no double charge on the new routes: none of the three routes is
  wrapped in `sourceFetchRateLimitDirective` (ApiRoutes.scala:951/1007/1011). Apply's dry run does not charge
  (`chargeFetches = false` in `PipelineProposalService.apply` and in the patch-set apply context). Exhaustion gives
  `TooManyRequests` (429 + Retry-After). But the principal key is NOT the directive's for a PAT caller, which C12 explicitly
  requires ("same InMemoryRateLimiter instance and principal key").
- Planning artifacts: partly stale (see CR3).

### Phase 2: Code Review — FAIL
- Canonical code-quality ([mechanical]): no inline FQNs (scala-quality clean). File sizes: `PipelineProposalService.scala` is 689
  lines (+77), already over budget before this change. Soft budget only, informational.
- Slices fit together. There is no duplicated root-shape logic left: `PipelineRootWrites.shapeProblem` / `inlineShapeProblem` are
  the single home, called by `resolveInlineRootSourceId`, `PipelineCreateWrites.rootShapeProblem` and the patch-set resolver. There
  is one node-schema projection (`PipelineOutputSchemas`) used by `createTransactional` and `PipelineCreateDryRun`. There is one
  inline-root schema dry run (`PipelineRootDryRun`) shared by the proposal and patch-set paths. `validateStatic`, `validateSqlCreate`
  and `validateRestCreate` are each called by both their create method and the dry run. I found no half-wired path: every
  production construction site of `PipelineProposalService`, `PatchSetPreviewService` and `PatchSetApplyService` (ApiRoutes
  542/580/592) gets the shared budget and `sourceService`.
- **Stale scaladoc left by the slice handoffs (CR2):**
  - `backend/src/main/scala/com/helio/services/pipelines/PipelineProposalService.scala:84-92` (`validate`) still says an inline
    source "gets structural validation only ... a non-mutating validate cannot do that ... (accepted asymmetry)". That is false now.
  - `PipelineProposalService.scala:104-107` (`dryRun`) still says "Inline rest/sql roots are not yet dry-run (no schema without a
    live fetch); an Output descending from one is not column-checked". Slice C added exactly that, so this is false now.
- Security: the dry-run REST fetch is SSRF-guarded (C11). The unpersisted Auto connector is never written. A connectorId root uses
  `findByIdOwned` plus the owner's credential decrypt, the same as apply.
- Tests are meaningful. The C12 test fails without the charge (mutation 2), and the fetch-failure reword test is red under mutation 3.
- **Test gap on "no double charge" (CR4):** `ProposalValidateRoutesSpec` "answer 429 ..." pins the budget to 1 but never asserts that
  the FIRST request is not 429. If someone later wrapped these routes in `sourceFetchRateLimitDirective` (a double charge), the
  first request would itself be 429 and the test would still pass.

### Phase 3: UI Review — PASS
Triggered by `ApiRoutes.scala` and `schemas/**`. There is no frontend change. I started the servers with `start-servers.sh` (7070/9977,
`assert-phase.sh servers` PASS) and signed in as the dev account. I exercised the new routes from the running app's origin, with the
session cookie and CSRF header:
- `POST /api/pipelines/validate-proposal`, valid inline static proposal: 200 `{"valid":true}`.
- The same with `yAxis: display_name`: 400 `fieldMapping references column(s) not present at this node: display_name. Available
  columns: name, wins`.
- `POST /api/dashboards/validate-proposal` with a missing Output: 400 `panel 'Gone': output ... not found`.
- `POST /api/proposals/validate` with the bad pipeline: 400, same column message.
- Unauthenticated: 401.
- The pipeline list was unchanged after all calls, so nothing was written.

The only console errors were the four deliberate 4xx responses above. `/home` and `/pipelines` rendered with 0 console errors.
Servers were stopped with `stop-servers.sh`. Breakpoint checks are N/A (no UI change).

### Overall: FAIL

### Change Requests
1. **C12 principal key for PAT callers.** File: `backend/src/main/scala/com/helio/services/ratelimit/SourceFetchBudget.scala:585`.
   The key is always `s"user:${user.id.value}"`. `RateLimitDirective` (api/http/RateLimitDirective.scala:71,80) keys a PAT caller
   `pat:<tokenId>`, so an MCP (PAT) agent's propose-time fetches draw from a different bucket than its preview/infer calls. The
   scaladoc's stated reason ("the route directive keys it pat:<tokenId>") does not hold: `AuthenticatedUser.tokenId` is
   `Some(tokenId)` exactly when `AuthDirectives` authenticated by PAT (AuthDirectives.scala:35, with the same cookie-first precedence
   as the directive).
   - Change `charge` to key `user.tokenId.fold(s"user:${user.id.value}")(t => s"pat:${t.value}")`, and fix the scaladoc.
   - Add a test: a PAT-authenticated `AuthenticatedUser` shares the bucket that `RateLimitDirective` uses for that token. For
     example, pre-consume N on `pat:<id>` in the shared limiter and show the propose-time fetch is refused.
   - Update `evidence/C12-bounded.md`.
2. **Stale scaladoc.** Rewrite `PipelineProposalService.scala:84-92` (`validate`) and `:104-107` (`dryRun`) to describe current
   behaviour:
   - inline static/sql/rest roots are dry-run through `PipelineRootDryRun`;
   - rest/sql fetches are charged to the source-fetch budget at propose and not charged on apply;
   - the fetch-failure reword applies.
   Remove the "accepted asymmetry" and "not yet dry-run" claims.
3. **Stale planning/evidence artifacts.**
   - `evidence/C12-note.md` says "this slice adds NO propose-time live fetch ... not done yet". Delete it or prefix it as superseded
     by `C12-bounded.md`.
   - In `apply-check-inventory.md`, the section "Status of rows after this slice" lists 1.4, 1.5, 1.7, D1b, D3 and D4 as "Not yet
     dry-run". Mark it as superseded by "Final classification (task 6.2)" or delete it, so the inventory reflects the final behaviour.
4. **Pin "no double charge" in the route test.** In `ProposalValidateRoutesSpec.scala`, test "answer 429 with Retry-After ...": assert
   the first `restPipeline` request's `status should not be StatusCodes.TooManyRequests` before asserting the second is 429.

### Non-blocking Suggestions
- Patch-set pipeline create with roots but no steps/outputs: `PatchSetPipelineResolvers.resolvePipelineCreate` skips `rootSchemas()`
  when `dryRun.preflight` returns `Right(None)`. An inline static/sql/rest root's pure create checks (`validateStatic`,
  `validateSqlCreate`, `validateRestCreate`) then do not run at preview, and apply rejects it at `createStatic`/`createSql`. This
  is not a regression (preview never checked it), but it is a gap against D1b step 2. One option is to run the pre-fetch validate
  checks without fetching in that case; HEL-1722 could also absorb it.
- `PipelineCreateDryRun` builds `PipelineServiceSupport(null, repo, null)` and `PipelineCreateTransaction(null, null, repo, null, support)`
  to reach two methods that use only `dataSourceRepo`. This works but is fragile: a future use of another collaborator inside
  `validateStepCrossOwnerRefs` would NPE only on the dry-run path. Consider lifting those checks into a small object that takes the
  repo.
- `SourceFetchBudget.default()` as a default constructor argument on production services (`PipelineProposalService`,
  `PatchSetPreviewService`, `PatchSetApplyContext.build`) means a new production construction site would silently get a private,
  unshared budget. Consider making it required in the production constructors and supplying it in test helpers.
- Parity corpus: `apply` itself runs the dry run first, so the corpus cannot detect a dry run that rejects too much on a reject
  entry. Consider one entry that runs `PipelineService.create` (write path only) for each reject case and asserts the same message.
- `SourceService.dryRunRestSchema`: `connectorRepo.findByIdOwned(...).flatMap { case None => Future.successful(None); case Some(c) =>
  Future.successful(Some(...)) }` should be a `.map`.
- `ProposalDryRunParitySpec` C12 test comment "The fetch happens only when an Output needs the root's columns checked" is imprecise.
  The patch-set path fetches whenever the create has steps or Outputs, and the proposal path fetches for every inline rest/sql root.
