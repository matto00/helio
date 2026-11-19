## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d4556de5260b2cd4ef508b449d238e581760c393` against the live-resolved base `42b0b2f3dffaa36c8c75dd46bd56aff4a9ec1c4a` (`resolve-review-base.sh`, exit 0). 33 files changed. The working tree is clean apart from the untracked `evaluation-2.md`. No UI change, so step 4 does not apply.

### What I verified (with evidence)

**Backend contracts the tools wrap. I read these against the source, not the reports.**
- `POST /api/outputs/:id/insight/refresh` (`OutputRoutes.scala:178-193`) reads `entity(as[String])`. `InsightRefreshBody.trigger` (`OutputRoutes.scala:292-300`) maps an empty body to `Manual`. `HelioHttpClient.send` sends no body and no Content-Type when `body === undefined`, so `refresh_insight` with no body is a valid manual refresh.
- `schemas/outputs/output-insight-response.schema.json` requires `outputId, render, lastAttempt, canRefresh`. That matches `OutputInsightResponse` in `types.ts`.
- `schemas/ask/ask-response.schema.json` defines `pin` as null or `{pipelineId, request}`. That matches `AskDashboardResponse.pin`.
- The kind enum in `schemas/pipelines/create-pipeline-transactional-output-request.schema.json` has 7 kinds, including `insight`. That matches `OUTPUT_KINDS` in `helio-mcp/src/tools/outputKinds.ts`.

**AC trace**
1. *"New helio-mcp tests that fail first."* I ran my own mutations and restored every file after each run (`git status` was clean afterwards):
   - `askHandlers.ts`: I changed the question body that is sent. Result: 2 failed (`insightExitCriterion` and `insightSurface` ask test).
   - `outputKinds.ts`: I dropped `insight`. Result: 3 failed (kind-enum equality, the add_output insight POST, and the exit criterion).
   - `pipelineProposal.ts`: I re-inlined the 6-kind `z.enum`. Result: 6 failed (the no-re-inline drift test, plus create_pipeline, analyze, apply, propose and combined accepting insight).
   - The tests fail when the code they guard is wrong.
2. *"Exit criterion scripted end to end against a fake-model backend: add insight Output to existing pipeline, cited narrative, ask on a dashboard."*
   - **Server half:** `InsightSeamSpec` drives the real `ApiRoutes` with a `ScriptedTransport` model. No live call is possible. It runs six legs: add the insight with `reads.outputs=[Revenue]`, refresh (202), read the narrative, place it via `/api/panels/batch`, ask the dashboard, and pin the answer. It asserts `hopCount shouldBe 3`, validates three raw bodies against their schemas, and asserts that the narrative cites Revenue with `[cN]` markers present. It then compares the normalised legs to `shared-test-fixtures/insight/exit-criterion.json`.
   - **Client half:** `insightExitCriterion.test.ts` drives the real `createServer` over an in-memory MCP client. The fake fetch answers only the recorded legs, in order, and requires each request body to deep-equal the recorded one. Every tool result `toEqual`s the recorded response.
   - **Fixture is real:** the narrative is `"The amount.current is 120.0 [c1]."`, citing `{{OUTPUT_REVENUE}}`. The ask answer is `"An amount is 10.0 [c1]."` with a non-null pin. The pin is replayed through `add_output` as `{pipelineId, ...pin.request}`, which includes `rootId`.
   - **Fixture is pinned:** I flipped `"started": true` to `false` in the fixture. `InsightSeamSpec` failed (`exit-criterion.json differs from what the real routes write`, `Tests: succeeded 0, failed 1`). I restored the fixture and confirmed with `git status`.
3. *"`audit-ci` stays green."* `npx audit-ci --config helio-mcp/.audit-ci.jsonc --directory helio-mcp` printed `Passed npm security audit.`
4. Ticket bullets:
   - insight is in the kind enums and descriptions for create_pipeline, add_output/update_output, propose_pipeline and add_outputs_from_shape. They all derive from one tuple, and a drift test forbids re-inlining it.
   - The three new tools are registered. `EXPECTED_TOOL_NAMES` is updated.
   - `insightSurface.test.ts` "place_outputs is kind-agnostic" tests `place_outputs` with an insight Output. `placements.ts` has no code change.

**Gates I re-ran (fresh, in the worktree)**
- Root `npx jest --maxWorkers=3` (nice 19): `Test Suites: 69 passed; Tests: 611 passed`, exit 0.
- `npm run lint`, `prettier --check` over the changed paths, `npm run check:helio-mcp-types`: all exit 0. `check:scala-quality`: clean. `check:openspec`: clean.
- `sbt -J-Xmx3g "testOnly com.helio.api.protocols.InsightSeamSpec com.helio.domain.model.OutputKindDriftSpec"` (nice 19): exit 0, `Tests: succeeded 15, failed 0`. The log shows exactly three scripted Claude hops.
- I did not re-run full `sbt testFull`. The only main-code backend change is a doc comment (`OutputConfigValidation.scala:39-40`). I relied on the evaluator's pasted full-suite result (`succeeded 9982, failed 0`), which is unambiguous.
- I searched for the altered identifiers (`outputKindSchema`, `OUTPUT_KINDS`, the new tool names, `DocumentedKnownKeys`) across `e2e/`, `helio-mcp/src`, `backend/src` and `docs`. There are no hits in `e2e/`. The other hits are the changed files and their existing specs, which pass.

**Iron Laws.** This is a feature, not a bug fix, so there is no root-cause requirement. The evaluator's cycle-1 change requests are resolved in the tree; I checked the Revenue citation and the `toEqual` pass-through assertions myself.

### Verdict: CONFIRM

### Non-blocking notes
- `OutputKindDriftSpec` now pins `AssistantProposalToolSchemas` and `KeysDoc` without `insight`, as "deliberate, no owning leaf scheduled". Before this change the spec named HEL-1747 as the owner of those sites. The proposal explicitly makes the in-app assistant a non-goal, and the ticket text names only the MCP tools, so this is in scope. Still, the in-app assistant now has no path to the insight kind. A follow-up ticket should give it an owner.
- `helio-mcp/src/tools/outputs.ts` has grown to 446 lines. A split into `tools/insightOutputs.ts` is worth proposing in the PR body, per CONTRIBUTING.
- `HARNESS_BASE_URL` in `mcpFetchHarness.ts` is exported but has no importer. `InsightSeamSpec.scala:49` has stale column padding.
- `HEL1747_WRITE_FIXTURE=1` writes the fixture and then compares it, so it passes by construction. That is the intended regeneration path, but CI must never set it.
