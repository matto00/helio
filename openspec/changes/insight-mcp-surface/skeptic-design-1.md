## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 42b0b2f3dffaa36c8c75dd46bd56aff4a9ec1c4a (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Kind enum sites (driver item c): complete.** `grep '"collection"'` over `helio-mcp/src` (non-test) finds
  exactly four literal Output-kind enums: `tools/outputs.ts:55`, `tools/pipelines.ts:152`,
  `tools/pipelineProposal.ts:89`, `types.ts:1106`. All other kind-ish enums are panel types
  (`placements.ts:94`, `write.ts:803`, `proposal.ts:45`) or patch-set target kinds (`patchSetTargetKinds.ts`), and are
  correctly out of scope. `pipelineProposalOutputSchema` also feeds `apply_combined_proposal`
  (`combinedProposal.ts` reuses `pipelineProposalInputSchema`). The spec's tool list omits that tool, but D5's
  single-source tuple covers it anyway.
- **Backend accepts insight as MCP would send it (driver item b): yes, with one doc caveat.**
  - `add_output` and `add_outputs_from_shape` (`pipelinesHandlers.ts:259-263`, which sends no config) go to
    `OutputService.create` (`OutputService.scala:139-160`). That path calls `OutputKind.fromString`, then
    `validateConfig(kind, {}, {})`. Insight `KnownKeys` = `InsightConfig.Keys`, `validateInsight` is skipped when no
    own key changed, `checkInsightReads` is skipped when `reads` is absent, and the insight `OutputBindingSpec` has no
    slots (`OutputBindingSpec.scala:111`). So an insight with no config, or with no `reads`, is accepted.
  - `create_pipeline`, `apply_pipeline_proposal` and `apply_combined_proposal` go through `PipelineCreatePreflight.checkOutput`
    (`:214-229`) and `PipelineProposalService.validateOutputs` (`:411`, kind parse only). Both accept `insight`.
    However, `PipelineCreatePreflight.scala:228-229` runs `InsightReadsCheck` with an EMPTY Output map ("a brand-new
    pipeline has no Output a new insight could read, so any named id is rejected"). On these tools, any non-empty
    `reads.outputs` is a 400. D6's planned doc text ("`reads.outputs` must be stored ids of other non-insight Outputs of
    the same pipeline") is false for create_pipeline/propose_pipeline/apply (see CR3).
  - The schema `create-pipeline-transactional-output-request.schema.json:14` lists `insight`, so D5's drift source is real.
- **Route claims (driver item d): accurate.**
  - `OutputRoutes.scala:155-160` is GET insight. `:178-193` is refresh: 202 `{outputId, started}`, with its own rate
    limiter.
  - `InsightRefreshBody.trigger` (`:292-300`) maps an empty/blank body to Manual, so D3 (no body) is valid. The MCP
    `httpClient.ts:256-261` sends no body and no Content-Type when `body === undefined`.
  - `output-insight-response.schema.json` requires `outputId, render, lastAttempt, canRefresh`, and its description
    matches the role-shaping wording in the spec delta.
  - The ask pin shape matches D4 (`AskPinBuilder.scala:31-45`: `nodeStepId` or `rootId`, plus `kind`, `name` and
    `config{prompt, reads, refresh: manual}`). All of these are `add_output` arguments.
  - `AuthDirectives.confineScopedToken` only confines SCOPED PATs (hooks-only). `requireCsrfHeader` exempts
    cookie-less (PAT) callers, so the MCP can reach all three routes.
- **D7's premise (driver item a): true, but the plan built on it is wrong in two load-bearing places.**
  - True: `HttpClaudeTransport.scala:146` hardcodes `https://api.anthropic.com/v1/messages`, and `Main` passes no
    transport, so the assembled backend cannot boot with a fake model unless prod code changes. Rejecting the
    live-backend option is justified.
  - Wrong 1: D7 says `InsightSeamSpec` "reus[es] `OutputInsightApiHarness`/`InsightRenderFixture`/`ScriptedTransport`"
    with a scripted model on the real routes. In fact:
    - `OutputInsightApiHarness.startInsightApi` (`OutputInsightApiHarness.scala:46-56`) builds `ApiRoutes` with neither
      `claudeConfigProvider` nor `claudeTransportFactory`. Its refresh therefore produces "a failed, no-model row"
      (`OutputInsightRoleAndRefreshRoutesSpec.scala:118`).
    - `InsightRenderFixture` fakes at the `InsightModelClient` level (`FakeInsightModel`, `InsightRenderFixture.scala:33`)
      and builds its own `InsightRenderService`, not the routes.
    - The only seam that scripts a model through real `ApiRoutes` is `claudeConfigProvider` +
      `claudeTransportFactory` (`ApiRoutes.scala:227-228, 249-250, 489-497`). Precedent: `AskApiHarness.buildAskApi`
      (`AskApiHarness.scala:154-169`). The wire-level reply format for an insight render is shown by
      `ClaudeInsightClientSpec`.
  - Wrong 2: D7/Risks say to "await the render the way `OutputInsightApiHarness` tests already do (no sleeps)". Those
    tests use `Thread.sleep(1000)` and `Thread.sleep(800)` (`OutputInsightRoleAndRefreshRoutesSpec.scala:127,133`).
- **Exit-criterion coherence (driver item a, faithfulness): the scripted story is not covered by recorded fixtures.**
  - The D7 MCP script calls six tools: `add_output` → `refresh_insight` → `get_output_insight` → `place_outputs` →
    `ask_dashboard` → pin `add_output`. The fake `fetch` is said to answer "ONLY the recorded method+path pairs" and the
    Risks section says "every fake body is a committed fixture the backend seam spec regenerates".
  - But `InsightSeamSpec` records only create, refresh and GET insight. `place_outputs` issues `POST /api/panels/batch`
    (`placementsHandlers.ts:42`), and no seam records that. The pin `add_output` is not recorded either.
  - The ask leg "reuses the existing ask fixtures". Those were recorded on a different board whose Outputs are the
    tables "Revenue"/"Cost" (`AskSeamSpec.scala:44-49`, `ask-200-pin.json`), not the dashboard the insight was just
    placed on. They are response bodies only, with no recorded request/path pair.
  - As written, the test either fails on its own refuse-unrecorded rule or quietly hand-builds bodies, which defeats
    the design's anti-drift argument.
- **Collateral sites the plan does not name:**
  - `helio-mcp/src/server.test.ts:55,214`: `EXPECTED_TOOL_NAMES` is asserted by sorted equality, so all three new tools
    must be added there.
  - `docs/agent-native.md:140-165`: the MCP tool ↔ route table has a row per tool, including `get_output_history`.
    Neither is in the Impact or the tasks.
- **Placeholders/hand-waving:** no TODO/TBD found. tasks.md has an empty `## Standing Constraints` heading, and a
  "### Backend" subheading under the helio-mcp section (cosmetic).
- **Scope:**
  - The ticket ACs are mapped as follows. "New helio-mcp tests that fail first" → 2.1/3.1. Exit criterion → 1.x/3.1.
    audit-ci → 3.4.
  - No AC is uncovered. No backend behavior change, and the D8 comment-only edit is in scope.

### Verdict: REFUTE

### Change Requests

1. **Fix D7's backend harness claim (design.md D7, tasks.md 1.1).** `InsightSeamSpec` must build `ApiRoutes` with
   `claudeConfigProvider = () => Right(ClaudeConfig(...))` and `claudeTransportFactory = Some(_ => <scripted
   ClaudeTransport>)`, as `AskApiHarness.buildAskApi` does. That way the refresh goes through the real
   `ClaudeInsightClient` → `InsightRenderer` path.
   - State that neither `OutputInsightApiHarness` (keyless, renders fail) nor `InsightRenderFixture`
     (`FakeInsightModel`, service-level) gives a scripted model on the routes.
   - Name the scripted reply's wire format source (`ClaudeInsightClientSpec`).
   - State the preconditions the render needs: a pipeline owner whose tier passes the quota gate, and seeded snapshots
     and history so the reply can cite real numbers.
2. **Replace the "no sleeps, the way existing tests do" await with a real mechanism (design.md D7 + Risks).** The
   existing refresh specs sleep. Specify a deterministic wait, for example ScalaTest `eventually` with an explicit
   patience config, polling `output_insights` for an `ok` row. Also say how the spec avoids a second, unscripted
   render: the create's backfill or an `on_run` trigger could race the explicit refresh (`started: false`), or consume
   a scripted transport turn. Either create the insight with `refresh: "manual"`, or show why no other render can fire.
3. **Make D6's insight doc accurate per tool (design.md D6; spec `mcp-output-tools`).** On `create_pipeline`,
   `propose_pipeline`, `apply_pipeline_proposal` and `apply_combined_proposal`, `reads.outputs` cannot name any id:
   every named id is a 400 (`PipelineCreatePreflight.scala:228-229`). Absent or empty `reads` is the only accepted form
   there. The "stored ids of other non-insight Outputs of the same pipeline" wording applies only to
   `add_output`/`update_output`.
   - Either split the constant (one for existing-pipeline writes, one for create/proposal), or add the create-time
     sentence.
   - Add a doc-assertion test pinning that sentence on `create_pipeline`.
4. **Make the exit-criterion fixtures one coherent, fully recorded scenario (design.md D7, spec "Agent exit criterion",
   tasks 1.1/1.2/3.1).** Every request the MCP script issues must have a recorded method + path + request body + response
   produced by a backend seam spec on the real routes, or else be removed from the script. Concretely, either:
   - (a) extend `InsightSeamSpec` to also record, in the same seeded world: `POST /api/panels/batch` placing the insight
     Output on a dashboard, `POST /api/dashboards/:id/ask` on THAT dashboard with a scripted cited answer, and the pin
     `POST /api/pipelines/:id/outputs`; or
   - (b) drop `place_outputs` and the pin step from the exit script and say explicitly that the ask leg runs on the
     separate `AskSeamSpec` world, with the ask request pair recorded rather than assumed.

   Option (a) is what "an agent adds an insight ... and asks a question on a dashboard" reads as. Whichever you choose,
   state the placeholder → concrete-id mapping rule, so ids stay consistent across legs.
5. **Name the collateral edits in Impact and tasks:**
   - add `get_output_insight`, `refresh_insight` and `ask_dashboard` to `EXPECTED_TOOL_NAMES` in
     `helio-mcp/src/server.test.ts` (sorted-equality test);
   - add three rows to the tool ↔ route table in `docs/agent-native.md`;
   - add `apply_combined_proposal` to the spec's list of kind-accepting tools.

### Non-blocking notes

- Task 3.2 says "`sbt testFull` scoped to the touched specs". `testFull` is the full suite. Say which command scopes
  it (for example `testOnly` with the CLAUDE.md caveat about sbt 2 caching), or run the full suite.
- tasks.md cosmetics: the empty `## Standing Constraints` heading, and "### Backend" under the helio-mcp section.
- The `add_output` description should tell an agent that creating an insight does not render it immediately: it
  renders on the next real run (`on_run`), or on `refresh_insight`.
- The pin's `rootId` may equal the pipeline id when the cited Output has no stored root (`AskPinBuilder.scala:33`).
  This is existing backend behavior, but worth one assertion in the scripted pin leg if option 4(a) is chosen.
