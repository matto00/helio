## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `eee4573653e4c3d03b78921e735bdad3ec047d6a`. The base was resolved live with `resolve-review-base.sh` as `fd7064f7d700e49a2f7dfc1f6a244aab02048fd2`. The only untracked file is `evaluation-2.md`. Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/dry-run-proposal-apply-checks/HEL-1638`.

### What I verified (with evidence)

**Shared code, not parallel copies (the core claim).** I read the full main-code diff.
- **Column check.** `OutputFieldMappingCheck.validate` is reached through `PipelineOutputSchemas.outputMappingProblem`. Its callers are `PipelineCreateTransaction.buildOutputsAction:192` (apply) and `PipelineCreateDryRun:72` (propose), plus the HEL-1639 call sites, which are unchanged. Node projection is `PipelineOutputSchemas.outputNodeSchemas`/`nodeInputs`, called by `createTransactional:58,62` and `PipelineCreateDryRun:41`. A grep finds no other `NodeStepInput` builder on these paths.
- **Inline create checks are extracted into functions the create methods call themselves:**
  - `SourceService.validateSqlCreate` / `validateRestCreate`;
  - `DataSourceService.validateStatic`, with the same `DatasetMaxRows` that `staticMaxRows` aliases;
  - `PipelineRootWrites.shapeProblem`/`inlineShapeProblem`.
- **Ownership checks** live in `PipelineStepOwnership`; `PipelineCreateTransaction.validateStepCrossOwnerRefs` delegates to it.
- **Panel checks** use `PanelCreateBuilder.run`, with `buildForCreate` = `Real`.
- **One request composition.** `RestApiConnectorDriver.composeRequest` is factored out of `buildResolvedRequest` unchanged, and the dry run calls the same function.
- **Mutation evidence (`evidence/mutation-4.1-shared-functions.txt`).** Breaking `outputNodeSchemas` turns both propose-side and `POST /api/pipelines` tests red. Breaking `outputMappingProblem` turns the patch-set and proposal parity entries red, plus the `DisabledStepOutputColumnRoutesSpec` GUARD on the apply path.

**Attempts to find over-rejection.** Apply now runs the dry run first, so a dry run that is stricter than the write path would silently change apply, and the parity corpus cannot see that. I checked each place where that could happen:
- Secondary schemas: the dry run uses `findByIdOwned` and apply uses `findByIdInternal`. These are equivalent, because the same `findByIdOwned` ownership check must pass first.
- The `sourceId` "dry-run" placeholder: `PipelineCreatePreflight.run` never reads `sourceId`.
- Untrimmed `sourceId`: the old path and the dry run both leave it untrimmed.
- The steps and Outputs passed to `pipelineService.create` are the proposal's own, unchanged (`createPipeline:550-560`).
- The root-check-before-preflight order matches PPS's historical resolve-roots-then-create order.
- The patch-set resolver follows `checkedCreate`'s order and keeps the same `edit N:` messages for blank and missing `sourceId`.

I found no divergence.

**Fresh gates (mine).**
- `nice -n 19 sbt -J-Xmx3g "testOnly ..."` over 10 suites: Parity, RestSchema, AssistantColumnLoop, SourceFetchBudget, ProposalValidateRoutes, DisabledStepOutputColumnRoutes, PatchSetPipelineCreateDryRun, and the PPS, Combined and Dashboard ValidateSpecs.
  - Result: `Suites: completed 10, aborted 0`, `Total number of tests run: 59`, `Tests: succeeded 59, failed 0`, `All tests passed.`, exit 0.
- `npx jest --maxWorkers=3` on the three changed helio-mcp test files: 3 suites, 15 tests passed.
- I relied on the evaluator's pasted full `testFull` (9528/0 at the same HEAD) for the rest of the suite.

**Live probes.** Servers were started with `start-servers.sh` 7070/9977, `assert-phase.sh servers` printed PASS, and they were stopped with `stop-servers.sh` (`STOPPED`). All calls were made from the signed-in dev session.
- **SSRF (C11).** I sent `POST /api/pipelines/validate-proposal` with an inline `rest_api` root and an Output mapping `id`/`name`:
  - `http://169.254.169.254/latest/meta-data` returned `400 roots[0]: could not read the source schema (URL host '169.254.169.254' resolves to a disallowed address), so fieldMapping cannot be checked`.
  - `127.0.0.1` and `localhost` returned the same message.
  - The live dry-run fetch is guarded by the HEL-879 check in `issueAndParse`. The same blocked URL with no Outputs returned `200 {"valid":true}`. That is the apply-parity fetch-failure rule (apply keeps the source with an empty schema).
- **C12 bound, shared bucket, no double charge.**
  - 4 earlier calls plus 26 in a loop returned 200. Every call after that returned `429`, with `Retry-After: 52` and the budget message.
  - Total before refusal: exactly 30, which is the `SOURCE_FETCH_RATE_LIMIT_PER_WINDOW` default. So each propose is charged once, not twice.
  - A following `POST /api/data-sources/infer` (the `sourceFetchRateLimitDirective` route) was also refused with `429 Rate limit exceeded`. Only about 40 general `/api` calls had been made, well under the 120 general limit, so this proves one bucket shared between propose fetches and the HTTP preview/infer routes.
- **PAT keying.**
  - `SourceFetchBudget.principalKey` = `tokenId.fold("user:<id>")("pat:<tokenId>")` matches `RateLimitDirective.resolveKey` (`user:${user.id}` / `pat:${tokenId}`) exactly.
  - It is pinned by `SourceFetchBudgetSpec`, with red-first evidence in `red-cycle2-CR1-pat-key.txt`.
  - The validate routes carry no `sourceFetchRateLimitDirective` (route code read), and the patch-set preview route is not wrapped either. A grep finds the directive only on `DataSourcePreviewRoutes`/`SourcePreviewRoutes`.
- **No unbounded fan-out from the assistant loop.** Every propose-time fetch site is listed below, and each is charged per fetching root before the fetch:
  - `PipelineProposalService.validate` (`chargeFetches = true`);
  - combined, through PPS.validate, called once;
  - `PatchSetPreviewService` (`build(..., chargeFetches = true)`), which also covers `RefinementService` and assistant `propose_patch_set`.
  - The only `buildUncharged`/`SourceFetchBudget.default()` uses are patch-set apply and the draft-definition read (no `SourceService`).
  - Apply's uncharged dry-run fetch is a re-fetch on an apply path that already made one uncharged create fetch before this change. It adds no new unbounded class, and apply is not an assistant tool.

**Disabled-step apply change.**
- `nodeInputs` passes `enabled = s.enabled.getOrElse(true)`, matching analyze and the run.
- `DisabledStepOutputColumnRoutesSpec` exercises direct `POST /api/pipelines`, with red-first evidence in `red-2.6-disabled-step.txt`.
- A GUARD test proves the enabled step still rejects.
- The change is stated in the design. The PR body must state it.

**C8.**
- `git diff --name-only` shows no file under `infrastructure/ai/` and no main-code file under `services/assistant/`. Assistant changes are test-only.
- `AssistantProposalToolSchemas` is untouched, and there is no `frontend/**` change.

**Acceptance criteria traced.**
1. **AC1: met.** `PipelineProposalServiceValidateSpec` covers both a column dropped by an upstream select and a column never in the source. It is red on the base (`red-1.1.txt`, "losses accepted") and green now.
2. **AC2: met** by shared functions plus a test proving the same function runs on both paths.
   - Shared functions: see above.
   - `ProposalDryRunParitySpec` corpus: validate or preview, then real apply, comparing accept or reject and the message.
   - Mutation proof: both sides go red.
   - C10 discriminating entry: `ProposalDryRunRestSchemaSpec` records the dry run's and `createRest`'s composed request from a local HTTP stub. It sees `/items?a=1&page=2&a=2`, identical on both sides.
3. **AC3: met.**
   - `AssistantColumnLoopSpec` uses a scripted transport. Hop 2's request carries hop 1's `tool_result`, which has `isError = Some(true)` and contains "not present at this node", "Available columns:" and "owner_id".
   - Hop 2's lookup proposal is captured. The counters show `proposeAttempts 2` and `proposeValidationFailures 1`.
   - A mutation turns it red (`red-4.2`).
   - In `AssistantToolExecutorSpec`, the propose_pipeline column case returns Left and captures nothing.
4. **AC4: unmet live, by directive.** The scripted replay is honest about what it proves:
   - It proves the loop mechanics: the error is fed back, the agent can retry, and the corrected proposal is captured.
   - It does not prove what a real model would do. The model's correct second hop is scripted, the rosters/users roots are existing sources rather than live REST, and hop 2 is accepted by the shared check but never applied in that test.
   - It is acceptable only if the PR states AC4 as unmet live.

**MCP.**
- `proposePipelineHandler`/`proposeDashboardHandler` call `validatePipelineProposal`/`validateDashboardProposal` before any read.
- A thrown `HelioApiError` goes through `guarded` (`pipelineProposal.ts:42`, `proposal.ts:107`) and comes back as `isError: true`, with the backend message.

**Mtime gate-defect check.** No mtime-ordering evidence was relied on by me or by the evaluator reports I read.

### Verdict: CONFIRM

### Non-blocking notes
- **Inventory row overclaims.** `apply-check-inventory.md`, Final classification, row "4 patch-set pipeline create | dry-run", has no caveat. `resolvePipelineCreate` runs the root dry run (inline `validateStatic`/`validateSqlCreate`/`validateRestCreate`) only after preflight returns `Some`. So a roots-only patch-set pipeline create skips the inline create checks at preview. HEL-1722 already tracks this explicitly; the row should say so before the change is archived.
- **Stale MCP tool description.** The `propose_pipeline` description (`helio-mcp/src/tools/pipelineProposal.ts:~144-149`) still says "Read-only-checks a given `sourceId` resolves..." and "non-SELECT is rejected at apply time, never re-validated here". It now runs the server dry run, including SQL `checkQuery`. This is the MCP description, not an assistant `input_schema`, so C8 does not stop a follow-up from fixing it.
- **Retries spend fetch budget.** PPS's dry run computes inline rest/sql root schemas, with their charged fetch, before preflight. This mirrors apply's resolve-roots-first order. The cost: an agent iterating on a step or preflight error spends one fetch-budget unit per inline rest/sql root on every retry. With the 30/min budget it can reach 429 sooner than needed.
- **Raw remote body in the message.** The fetch-failure message embeds the connector error verbatim. For a non-2xx response that is `HTTP <code>: <full body>` (`issueAndParse`), which goes into the 400 message and the assistant's `tool_result` with no truncation. Consider a cap.
- **No regression test for the SSRF guard on the dry-run path.** No spec pins that the dry-run fetch is guarded: the specs admit localhost by design. I verified it live (above). A spec with a blocked host and an Output, asserting the disallowed-address message and zero recorded requests, would make C11 regression-proof.
- **PR body must state:**
  - AC4 is unmet live (scripted replay only);
  - the new propose-time egress and that it is charged to the shared source-fetch bucket (C11/C12);
  - apply now fetches an inline rest/sql root twice (dry run, then create);
  - the disabled-step apply change;
  - patch-set panel-update failures are now resolve-time 400s;
  - the remaining apply-only rows: cycle guards, sentinel-panel controls, dropdown eq/in cardinality, and HEL-1722 scope.
