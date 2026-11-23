## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `8c43285623c3e66bf68488545990b37fd459afbc`. Diff base `e3d78e580a90886e082cbc0f8085b8e20c508014`, resolved live with `resolve-review-base.sh` (exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/proposal-dryrun-fetch-hardening/HEL-1727`.

### What I verified (with evidence)

**Source diff, read in full.** The change touches `PipelineRootDryRun.scala` (the `capFetchError` cap), `PipelineProposalService.scala` (`dryRun` reordered), `PipelineCreateDryRun.scala` (the dead `check` removed, doc updated) and `helio-mcp/src/tools/pipelineProposal.ts` (description), plus three new or extended specs and one new helio-mcp test. No existing test expectation was modified; the test diff only adds code.

**AC1: the fetch-failure text is capped.**
- `PipelineRootDryRun.rootSchema`'s `inline` mapping applies `capFetchError`. It is the only place `fetchError` enters `Root`. A grep for `rootSchema(` / `fetchError` shows that both consumers (`PipelineProposalService.dryRun` and `PatchSetPipelineResolvers:149/168`) read it from there, so the proposal path and the patch-set path are both covered. The cap applies to rest and sql roots alike.
- Code-point safety: the `codePointCount <= 500` guard runs before `offsetByCodePoints(0, 500)`, so a string of 400 emoji (800 UTF-16 units) does not throw, and the cut never splits a surrogate pair. Tests cover the 100k-character body, exactly 500 code points, short text, 400 emoji, and a surrogate pair straddling the cut.
- The assistant `is_error` tool result: `AssistantToolExecutorSpec` "bound the is_error tool_result ..." drives the real `PipelineProposalService` through `executor.execute("propose_pipeline")` and asserts the result contains `[truncated]` and is under 1500 characters.
- Mutation I ran myself: replaced `x.fetchError.map(capFetchError)` with `x.fetchError`. Three specs went red: the is_error spec, the 100k-character truncation spec and the surrogate-pair spec. Result line: `Tests: succeeded 37, failed 3`. Raw output: `.concertino/scratch/HEL-1727/skeptic-mutation-cap.txt`. I reverted with `git checkout`, and the sha256 matched the pre-mutation hash.

**AC2: the SSRF guard on the dry-run fetch is pinned.**
- `ProposalDryRunEgressGuardSpec` sets up a real Pekko server on `127.0.0.1:0` that counts hits, uses the real `RestApiConnectorDriver` with the default `isBlocked` and no `fetchOverride`, and goes through `PipelineProposalService.validate`, which is the propose path. It asserts that the rejection quotes the guard's own text (read from `ContentSourceSupport.validateAndResolve`) and that the server got 0 hits.
- A sanity case admits `127.0.0.1` and shows the server is reached (hits >= 1, `Right(())`), so the zero-hit result is not vacuous.
- No outbound call: the only target is loopback.
- My own bypass mutation, different from the executor's: in `RestApiConnectorDriver.inferSchemaForConnector` I replaced `issueAndParse(request)` with an unguarded `Http(system.classicSystem).singleRequest(request)` plus a body parse. The spec went red: "should be refused by the egress guard ... *** FAILED *** a loopback dry-run fetch was accepted (ProposalDryRunEgressGuardSpec.scala:109)". Result line: `Tests: succeeded 1, failed 1`. Raw output: `.concertino/scratch/HEL-1727/skeptic-mutation-bypass.txt`. I reverted with `git checkout`, and the sha256 matched.

**AC3: preflight runs before the charged fetch, and propose and apply agree.**
- `PipelineProposalService.dryRun` now builds the `CreatePipelineRequest`, then calls `createDryRun.preflight` (`PipelineCreatePreflight.run` plus `validateCrossOwnerRefs`), and only then folds the root schemas, where `beforeFetch` charges the budget.
- When preflight returns `None`, the roots are still dry-run, so the inline create checks are kept.
- `apply` calls the same `dryRun` (with `chargeFetches = false`), so propose and apply share one ordering. The patch-set resolver already used this order at lines 156-168.
- `ProposalDryRunFetchHardeningSpec` asserts that a preflight-failing union gets `never()` `dryRunRestSchema` calls and leaves the 1-unit budget unspent. A positive case asserts exactly one fetch when preflight passes.
- The executor's recorded order mutations (`evidence/mutation-4`, `mutation-5`) are consistent with this. I did not re-run them; the code ordering is plain from the diff.
- The `fieldMapping` column check needs the schema, so it stays after the fetch. The doc comment says so.

**AC4: the MCP description matches the behaviour.**
- The "never re-validated here" sentence is gone.
- The new text says propose runs a dry run, makes one live schema fetch per inline rest/sql root charged to the source-fetch limit (429 when exhausted), and truncates the error to 500.
- The SQL read-only claim is true at propose: `validateStructure` (line 310) runs `SqlConnectorDriver.checkQuery` on inline SQL sources before `dryRun`.
- The new jest test passed fresh from the root config: 2/2.

**Gates, run fresh by me** (`nice -n 19 sbt -J-Xmx3g`, lane `DATABASE_URL`, `ANTHROPIC_API_KEY` empty):
- Egress, Hardening, AssistantToolExecutor and PipelineProposalServiceValidate specs: `Tests: succeeded 53, failed 0`, `[hel1468-guard] failed=0`. Output: `.concertino/scratch/HEL-1727/skeptic-green.txt`.
- After both reverts, ProposalDryRunParity, CombinedProposalServiceValidate, ProposalDryRunRestSchema, PatchSetPipelineCreateDryRun and Egress specs: `Tests: succeeded 35, failed 0`, guard `failed=0`. Output: `skeptic-green2.txt`. This run also shows the restored main code compiles and passes.
- helio-mcp `proposePipelineDescription.test.ts`: 2 passed.

**UI:** none changed, so no servers were started.

**git status** after my work: clean apart from the evaluator's untracked `evaluation-1.md` and `evaluation-2.md` and this report.

### Verdict: CONFIRM

### Non-blocking notes
- `PipelineProposalService.finishPipeline` (around line 616) still quotes the persisted-path `fetchError` uncapped into an apply's blocked-run `blockedReason`. This predates the change, is outside the dry run, and the design (D1) explicitly leaves capping `issueAndParse`-level text out of scope. It is a possible follow-up if apply responses ever reach the model's context.
- The MCP description says "500 characters"; the count is in code points. Fine for an agent-facing hint.
- The MCP description keeps the old "SQL source/step" phrasing. Pipelines have no SQL step type, so "step" is vestigial. Harmless.
- The PR body must state that helio-mcp needs a redeploy at release (a driver constraint).
