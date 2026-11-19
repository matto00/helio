## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD 42b0b2f3dffaa36c8c75dd46bd56aff4a9ec1c4a. The planning artifacts are untracked in the change dir.
Every claim below was checked against the live source, not against the planner's narrative.

### Round-1 change requests: resolution

1. **CR1 (harness): resolved.**
   - D7 now builds the real `ApiRoutes` with `claudeConfigProvider` and `claudeTransportFactory = Some(_ => scripted)`.
     It names `AskApiHarness.buildAskApi` (`AskApiHarness.scala:154-169`, verified) as the precedent, and explicitly
     rules out `OutputInsightApiHarness` and `InsightRenderFixture`.
   - It names `ClaudeInsightClientSpec` as the source of the wire format.
   - It names the preconditions: a beta- or owner-tier owner, a snapshot, and history points.
2. **CR2 (await, second render): resolved.**
   - The wait is `eventually` with `PatienceConfig(10 s, 50 ms)` polling for the `ok` row. There is no sleep.
   - Creating the insight with `refresh: "manual"` rules out a second render, and I checked every other path:
     - `renderForRun` only renders `on_run` insights (`InsightRenderService.scala:96`).
     - `tickPass` is wired only from `Main.scala:313`, never from `ApiRoutes`, so there is no tick in the spec.
     - Backfill (`PipelineRunBackfill.scala:75-91`) never renders. It is also a no-op when the node already has rows.
   - D7's "no create-time backfill can fire a second render" is therefore true, but trivially so: backfill never
     renders at all.
   - The call-count assertion backs this up.
3. **CR3 (per-tool reads doc): resolved.**
   - D6 now has two constants. `INSIGHT_CREATE_READS_DOC` states the create-time 400, matching
     `PipelineCreatePreflight.scala:228-229` (`InsightReadsCheck` with an empty map).
   - Its "or send `outputs: []`" is also true:
     - `InsightConfig.parseReadOutputs` accepts an empty array.
     - `InsightReadsCheck` finds no offending id in an empty list.
   - The doc-assertion tests are planned on `create_pipeline` and `propose_pipeline`.
4. **CR4 (one recorded world): resolved via option (a).**
   - D7 lists six legs, each as {method, path, request body, status, response body}, all in one seeded world.
   - It sets the placeholder → concrete-id rule: one concrete id per placeholder for the whole test.
   - The fake refuses any unrecorded or out-of-order request, and every MCP request body is asserted equal to the
     recorded one.
   - The spec delta was updated to match.
5. **CR5 (collateral): resolved.**
   - `EXPECTED_TOOL_NAMES` (`server.test.ts:55,214`) and the `docs/agent-native.md` table are in the Goals, Impact and
     tasks 2.1/2.6.
   - `apply_combined_proposal` and `analyze_pipeline_proposal` are now in the spec's tool list. Both use
     `pipelineProposalInputSchema`: `pipelineProposal.ts:164`, `combinedProposal.ts:99`.

### Fresh review: is D7 feasible on the real ApiRoutes with one ordered transport?

- **One shared transport instance: yes.** `transportFor` (`ApiRoutes.scala:249-250`) calls the factory once per
  Claude-bearing service. That covers insight at `:496`, ask at `:879`, the AI step and the assistant. With
  `Some(_ => scripted)`, every service gets the same instance, so a single hop counter orders render and ask calls
  across services.
- **Render goes through `sendTool`: yes.** `ClaudeInsightClient.render` calls `client.sendWithTools` with `tools = Nil`
  and `maxHops = 0`. The existing `ScriptedTransport` implements only `sendTool` (its `send` and `stream` throw), so it
  serves both the render (hop 0) and the ask hops (1..n) without a new transport class.
- **Ordering is deterministic.** The render finishes, and is awaited by `eventually`, before the ask request is issued.
- **Retries are caught.** A validator-rejected render retries once (`rowFor` "after one retry"), and an ungrounded ask
  retries once. Either retry would consume an extra hop: `ScriptedTransport` reuses its last step, and the planned
  call-count assertion fails.
- **The seed fits the pin leg.** `AskApiHarness.addOutput` and `seedRows` create root-bound Outputs whose
  `root_id = pipelineId` (`AskApiHarness.scala:221,229`). So the pin's `rootId` fallback (`AskPinBuilder.scala:33`)
  names a real root, and leg (6) is a valid `add_output` body.
- **MCP accepts the pin request.** add_output's zod schema (`outputs.ts:151-158`) accepts `rootId`, `kind`, `name` and
  `config`, so `add_output({pipelineId, ...pin.request})` passes.

### Fresh review: does an insight Output on the dashboard break the ask loop's tools?

- **No.**
  - `list_board_outputs` (`AskToolExecutor.scala:79-94`) lists every in-scope Output generically: id, name,
    `OutputKind.asString` (which includes `insight`), panels and columns. It has no kind filter that could fail.
  - `get_output_rows`, `get_output_history` and `get_history_rows` re-check scope and run only on the id the script
    names, which is Revenue.
  - `AskPinBuilder.build` filters insight Outputs out of `reads` (`:20`). Even if the model cited the insight, the pin
    would stay valid.
- **Not exercised:** a scripted model calling `get_output_rows` on the insight Output itself. That case is not part of
  this ticket's exit criterion.

### Other checks

- **Ticket ACs: covered.**
  - Fail-first helio-mcp tests: tasks 2.1 and 3.1.
  - Scripted exit criterion against a fake model: 1.1, 1.2 and 3.1.
  - audit-ci: 3.4.
- **Scope:** no backend behavior change. D8 is a comment-only edit, and its file exists at
  `backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala:39-41` (the design cites it by
  file name only, which is fine).
- **Placeholders:** no TODO or TBD. Task 3.2 now runs the FULL `sbt testFull`, which resolves the round-1 note.

### Verdict: CONFIRM

### Non-blocking notes

1. **Normalisation gap that will fail the fixture on the second run (fix it while writing 1.1).**
   - The owner's `GET .../insight` body carries `inputDigest` (`output-insight-response.schema.json:46`).
     `InsightDigest.compute` (`InsightDigest.scala:22,27,31`) hashes the head and compare Output UUIDs, which are
     random per run, so the digest changes every run.
   - The insight record ids (`render.id`, `lastAttempt.id`) are also random UUIDs, and none of the listed placeholders
     names them.
   - Fix: add explicit placeholders (for example `{{INSIGHT_ROW_n}}`, `{{INPUT_DIGEST}}`), or a UUID/64-hex sweep like
     `AskSeamSpec.normalise`.
   - Keep every cited value numeric. A date-only citation value (`yyyy-mm-dd`) is not caught by an instant regex like
     the one `AskSeamSpec` uses, and it would drift by day.
2. **`place_outputs` in the exit script must pass no `w`/`h`.** Any size hint triggers a follow-up
   `POST /api/dashboards/:id/auto-layout` (`placementsHandlers.ts:47-70`), which is not a recorded leg. The refuse rule
   would catch it, but say so in 3.1.
3. **Stale kind list in add_output's description prose.** The prose `(table/metric/chart/collection/timeline/markdown)`
   at `outputs.ts:132-133` is not touched by D5's single-source tuple. Add `insight` to it, or derive the text from
   `OUTPUT_KINDS`.
4. **tasks.md cosmetics.** Section 2 (helio-mcp tools) still has a "### Backend" subheading.
