## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 1f3b883bb46b24e7267d598c9fae00af12bed5db (base e3d78e580, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — PASS (with one test-honesty gap, filed under Phase 2)

- AC1 (cap): `PipelineRootDryRun.capFetchError` (500 code points + ` … [truncated]`, with the `codePointCount` check first) is applied at the one place both the proposal path and the patch-set create path read `fetchError` from. Tests cover: a 100,000-char body, exactly 500, short text, 400 emoji (800 UTF-16 units), a surrogate pair at the cut, and the assistant `is_error` tool_result (`AssistantToolExecutorSpec`). Met.
- AC2 (SSRF pin): `ProposalDryRunEgressGuardSpec` uses a real loopback server, the real driver, the default guard and no `fetchOverride`. It makes no outbound call. It includes an admitted-host sanity case so a zero hit count is not vacuous. Met, and the mutation proof holds (see Phase 2).
- AC3 (order): `PipelineProposalService.dryRun` now runs preflight and the cross-owner checks, then the root fold, then `checkOutputs`. Roots are still dry-run when preflight returns `None`. The doc comment covers the order, the reason, the multi-root serial caveat and propose/apply parity. Met.
- AC4 (MCP description): "never re-validated here" is replaced with text that matches the dry run (live fetch, rate limit, 429, the truncation). There is a test for it. Source only, no deploy. Met.
- Tasks 1.1–3.2 are all marked done and match the diff. There is no scope creep: the planning artifacts, two main files, three backend test files and two helio-mcp files changed. No migration, no API shape change, no frontend change.
- Driver constraints are honoured: a real blocked loopback target, no live model call, helio-mcp source only.
- `workflow-state.md` CONSTRAINTS: `[]`, so nothing to check.

Red-first judgment: **satisfied.** The hook refused a red-only commit. Instead, the executor committed red runs on main production code as `evidence/red-run-{1..4}*.txt`. Their content is self-authenticating, with no reliance on mtime ordering:
- the failure output quotes the untruncated `HTTP 500: xxxx…` body;
- Mockito's `Never wanted here: … dryRunRestSchema` points at main's line numbers;
- the mcp test shows `✕` on both cases.

I reproduced the red independently. I checked out e3d78e580's `PipelineProposalService.scala` and `PipelineRootDryRun.scala` under the new tests and got 4 failures (the cap ×2, the tool_result bound and the order) and 38 passes. The egress spec stays green on main, which is expected: the guard already exists, and it is pinned by mutation. Then I restored HEAD and confirmed `git status` was clean.

### Phase 2: Code Review — FAIL

Gates (my own fresh runs; output in `.concertino/scratch/HEL-1727/eval-*.txt`):
- Backend specs, every one in full, with DATABASE_URL set to the lane DB and `-J-Xmx3g`, `nice -n 19`. Every listed suite header appeared, the test counts were non-zero, and the hel1468 guard reported `failed=0`:
  - shard 1: `ProposalDryRunEgressGuardSpec`, `ProposalDryRunFetchHardeningSpec`, `AssistantToolExecutorSpec`, `ProposalDryRunRestSchemaSpec`: 45 passed;
  - shard 2: `PipelineProposalServiceValidateSpec`, `CombinedProposalServiceValidateSpec`, `PatchSetPreviewServiceSpec`, `PatchSetPipelineCreateDryRunSpec`: 39 passed;
  - shard 3: `ProposalDryRunParitySpec`, `RestConnectorEgressGuardSpec`, `PipelineProposalServiceRestConfigSpec`, `PipelineInlineSqlShapeSpec`, `PipelineProposalImplicitConnectorCleanupSpec`, `PipelineProposalRollbackConnectorSpec`, `PipelineApplyProposalSpec`: 85 passed.
  - The full `sbt testFull` was not run. Under C5 it was sharded to the affected and adjacent proposal, dry-run and egress suites.
- helio-mcp: root jest `helio-mcp` (3 workers): 69 suites and 623 tests passed, including `proposePipelineDescription.test.ts`. `npm run typecheck` in helio-mcp: 0.
- `npm run lint`: 0. `npm run format:check`: 0. `scripts/check-scala-quality.mjs`: clean (`PipelineProposalService.scala` is 708 lines and `AssistantToolExecutorSpec.scala` is 706. Both were already over the soft budget before this change, and they grew by about 15 and 26 lines.)

Mutation verification (my own):
- I replaced `guardedPoolSettings(request)` in `RestApiConnectorDriver.issueAndParse` with an unguarded default `ConnectionPoolSettings`. `ProposalDryRunEgressGuardSpec` went red ("a loopback dry-run fetch was accepted", line 109). I reverted it and `git status` was clean.
- The executor's mutation-1/2/3/4 evidence shows the intended test going red each time, with no collateral red. One gap: the evidence files record the run output but not the mutation diff itself. I reproduced mutation 2 myself.

Issues:

1. **A test assertion that cannot fail.** `ProposalDryRunFetchHardeningSpec.scala:105-106` (`budget.charge(user) shouldBe Right(())`, commented "nothing was charged") cannot fail. `failingFetch` mocks `SourceService.dryRunRestSchema`, so the `beforeFetch` closure, which is the only place the budget is charged (`SourceService.scala:219`), is never invoked on either order. Probe: I restored main's `PipelineProposalService.scala` and disabled only the `verify(never())` and message lines. The test still passed: 7/7, output in `eval-mut-budget.txt`. The spec scenario "the caller's source-fetch budget is not charged" is therefore asserted but not tested. Only the `verify(never())` carries the AC. Reverted, and `git status` was clean.
2. **Dead code.** `PipelineCreateDryRun.check` (`PipelineCreateDryRun.scala:45-50`) has no caller left. Its only caller was the `PipelineProposalService.dryRun` this change rewrote. `PatchSetPipelineResolvers` calls `preflight`/`checkOutputs` directly, and no test calls `check`. Leaving it invites a future caller to bring back the fetch-before-preflight order in a new place.
3. **Readability.** `ProposalDryRunEgressGuardSpec.scala:121` has the comment `// schema fetched: x and y are not columns of {"x","y"}? they are, so the proposal is accepted`. It reads as an unresolved question, not an explanation.

Other checklist items:
- DRY: the cap is one function. The order matches the patch-set resolver.
- Type safety: fine. The `null` constructor arguments in specs follow an existing pattern.
- Security: the guard is unchanged and now pinned.
- Error handling: unchanged.
- Over-engineering: none.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. No dev servers were started.

### Overall: FAIL

### Change Requests

1. `backend/src/test/scala/com/helio/services/pipelines/ProposalDryRunFetchHardeningSpec.scala`: make the budget assertion failable on its own.
   - In the order test, stub `dryRunRestSchema` with `thenAnswer` so the stub invokes its third argument (`beforeFetch`), returns its `Left` if there is one, and otherwise returns the failing `InlineDryRunSchema`. With the 1-unit budget, main's order then charges the unit and `budget.charge(user) shouldBe Right(())` goes red on its own.
   - Show that in a recorded mutation run: main's `dryRun` order, with the `verify(never())` line temporarily removed. Commit it under `evidence/`.
   - If you choose not to do this, delete the budget assertion and its "nothing was charged" comment, and do not claim that coverage.
2. `backend/src/main/scala/com/helio/services/pipelines/PipelineCreateDryRun.scala:45-50`: delete the now-unused `check` method. Update the class doc comment so it says callers run `preflight`, then resolve root schemas, then `checkOutputs`.
3. `backend/src/test/scala/com/helio/services/pipelines/ProposalDryRunEgressGuardSpec.scala:121`: replace the comment with a plain statement, e.g. `// admitted: the server's rows have columns x and y, which the chart maps, so the proposal is accepted`.

### Non-blocking Suggestions

- In future mutation evidence, include the mutation diff (`git diff` output) at the top of each `mutation-*.txt`, so the file proves what was mutated as well as what went red.
- The PR body must say helio-mcp needs a redeploy at release, as the driver constraint requires.
