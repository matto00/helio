## Context

See proposal.md (Why). helio-mcp tools are thin shells (`tools/<area>.ts`: zod `inputSchema` + `guarded(...)`) over
handlers (`tools/<area>Handlers.ts`) that call `HelioApi` (`helioApi.ts`) through `HelioHttpClient`. Tools register in
`server.ts` `createServer`. helio-mcp tests run under the ROOT jest (`jest.config.cjs`), so they gate every commit and
CI. Kind enums today (re-derived on main 42b0b2f3d): `tools/outputs.ts:55` `outputKindSchema` (add_output),
`tools/pipelines.ts:151-153` (add_outputs_from_shape `outputKind`), `tools/pipelineProposal.ts:89`
`pipelineProposalOutputSchema` (reused by create_pipeline at `pipelines.ts:107` and by the proposal tools),
`types.ts:1106` `PipelineProposalOutput.kind`. The backend already accepts `insight` on every one of those routes
(`schemas/pipelines/create-pipeline-transactional-output-request.schema.json:14`, `outputs/create-output-request`).
Backend routes wrapped: `GET /api/outputs/:id/insight`, `POST /api/outputs/:id/insight/refresh` (HEL-1743), `POST
/api/dashboards/:id/ask` (HEL-1745). Contracts: `schemas/outputs/output-insight-response.schema.json`,
`output-insight-refresh-response.schema.json`, `schemas/ask/ask-request|ask-response.schema.json`. Ask bodies are
already committed in `shared-test-fixtures/ask/*.json` and pinned to the real routes by `AskSeamSpec`.

## Goals / Non-Goals

**Goals:** the three tools (plus `EXPECTED_TOOL_NAMES` in `server.test.ts` and the tool ↔ route rows in
`docs/agent-native.md`), `insight` in every kind enum with config docs, an enum drift guard, the exit criterion
scripted with no live model call. **Non-Goals:** see proposal.md; also no `get_output_insight_history` tool (not in
the ticket; the history route stays reachable via REST only).

## Decisions

**D1 Tools live where their resource lives.** `get_output_insight` and `refresh_insight` go in `tools/outputs.ts`
(+ handlers in `outputsHandlers.ts`), beside `get_output_history`. `ask_dashboard` goes in a new `tools/ask.ts`
(+ `askHandlers.ts`) registered from `server.ts` (ticket names `ask.ts`). New `HelioApi` methods:
`getOutputInsight(id)`, `refreshOutputInsight(id)`, `askDashboard(id, question)`; response types in `types.ts`
mirror the schemas. Alternative (all three in `read.ts`/`write.ts`) rejected: those files are 350/1170 lines and
unrelated.

**D2 Pass-through, never reshape.** Each tool returns the backend body unchanged. The backend already role-shapes the
insight read (R3/R3b) and strips model/cost from ask; re-filtering in MCP would be a second, drift-prone policy.

**D3 refresh_insight sends no body.** The optional `{"trigger":"pin"}` is a web-UI bookkeeping value for its pin flow;
an MCP refresh is a plain manual refresh. No `trigger` argument is exposed. Alternative (expose it) rejected as
surface with no agent use.

**D4 ask_dashboard has no model argument** (owner ruling: server `CLAUDE_MODEL` at its catalog weight). zod bounds
`question` with `.min(1).max(2000)` on the raw string; the backend trims and re-validates (sole authority). The
description tells an agent how to pin: `add_output({pipelineId: pin.pipelineId, ...pin.request})` (the pin request
carries `kind`, `name`, `config`, `rootId`, all accepted by add_output).

**D5 Kind enum single source in helio-mcp.** Export one `OUTPUT_KINDS` tuple (new `tools/outputKinds.ts`) used by
`outputKindSchema`, `pipelineProposalOutputSchema`, add_outputs_from_shape, and a `OutputKind` type used by
`types.ts`. A drift test reads `create-pipeline-transactional-output-request.schema.json`'s `kind.enum` and asserts
set-equality with `OUTPUT_KINDS`, and greps `helio-mcp/src` (non-test) for any other literal kind-enum array (a
`"timeline", "markdown"` co-occurrence outside `outputKinds.ts`) so a re-inlined enum fails. Mutation proof: drop
`insight` from the tuple → red. add_output's prose kind list (`outputs.ts:132-133`) is derived from `OUTPUT_KINDS`.

**D6 Insight config docs, per write path.** Two constants in outputs.ts, both mirroring the schema description:
- `INSIGHT_CONFIG_DOC` (keys `preset`, `prompt`, `reads`, `refresh`, `maxSentences`, `maxChars`, `model`, empty
  `fieldMapping`, no `compare`/`historyPayloads`, ranges, defaults never stored, `model` from
  `GET /api/assistant-models`, absent `reads.outputs` = the other Outputs on the same node). Appended to add_output and
  update_output with the existing-pipeline rule: `reads.outputs` names STORED ids of other non-insight Outputs of the
  same pipeline. It also says creating an insight does not render it: it renders on the next real run (`on_run`), the
  daily pass (`daily`) or `refresh_insight`.
- `INSIGHT_CREATE_READS_DOC`, appended to create_pipeline, propose_pipeline, analyze/apply_pipeline_proposal and
  apply_combined_proposal: on these a brand-new pipeline has no stored Output to read, so any non-empty
  `reads.outputs` is a 400 (`PipelineCreatePreflight.scala:228-229`); omit `reads` (or send `outputs: []`) and add
  reads later with update_output.
`OUTPUT_CONFIG_KEYS_DOC` gains an `insight:` entry. Doc-assertion tests pin the stored-ids sentence on add_output and
the create-time 400 sentence on create_pipeline and propose_pipeline.

**D7 Exit criterion = one recorded world, two-sided seam, not a live backend.** The assembled backend cannot boot with
a fake model without a prod test hook (`HttpClaudeTransport.scala:146` hardcodes the Anthropic URL and `Main` passes no
transport), and a live key is forbidden, so:
- Backend (test-only) `InsightSeamSpec` (`backend/src/test/scala/com/helio/api/protocols/`). It builds the REAL
  `ApiRoutes` with `claudeConfigProvider = () => Right(ClaudeConfig(...))` and `claudeTransportFactory =
  Some(_ => scripted)`, exactly as `AskApiHarness.buildAskApi` (`AskApiHarness.scala:154-169`) does, so the refresh
  goes through the real `ClaudeInsightClient` → `InsightRenderer` path and the ask through `AskDataService`. Not
  `OutputInsightApiHarness` (keyless: its refresh writes a failed no-model row) nor `InsightRenderFixture`
  (`FakeInsightModel`, service level, no routes). The scripted render reply follows the wire format in
  `ClaudeInsightClientSpec`; the ask hops follow `AskScript`/`ScriptedTransport` (`AskApiHarness.scala:77`), one
  ordered script: render reply, then the ask's tool-use hops and cited answer.
- World (seeded once): a beta- or owner-tier user who owns a pipeline with a stored table/metric Output "Revenue",
  a successful run's snapshot and history points (so citations are real numbers), and a dashboard with "Revenue"
  placed. Recorded legs, in order, each as {method, path, request body, status, response body}: (1) `POST
  /api/pipelines/:id/outputs` insight with `refresh: "manual"` and `reads.outputs: [Revenue]`; (2) `POST
  .../insight/refresh` → 202 `started: true`; (3) `GET .../insight` as the owner, after the render, with ≥1 citation;
  (4) `POST /api/panels/batch` placing the insight on the dashboard; (5) `POST /api/dashboards/:id/ask` on THAT
  dashboard, cited answer with a non-null pin; (6) the pin `POST /api/pipelines/:id/outputs` from `pin.request`
  (asserting `rootId` as the backend writes it, `AskPinBuilder.scala:33`). `refresh: "manual"` means no `on_run`
  render, no daily pass and no create-time backfill can fire a second, unscripted render; the spec asserts the
  scripted transport saw exactly the expected number of calls.
- Await: after leg (2), ScalaTest `eventually` with an explicit `PatienceConfig` (timeout 10 s, interval 50 ms)
  polling `output_insights` for that Output's `ok` row; no `Thread.sleep`.
- Normalisation: generated ids → stable placeholders (`{{PIPELINE_1}}`, `{{OUTPUT_REVENUE}}`, `{{OUTPUT_INSIGHT}}`,
  `{{OUTPUT_PIN}}`, `{{DASHBOARD_1}}`, `{{PANEL_n}}`, `{{ROW_n}}`, insight record ids `{{INSIGHT_ROW_n}}`, the
  per-run `inputDigest` `{{INPUT_DIGEST}}`, plus a residual UUID/64-hex sweep like `AskSeamSpec.normalise`); cited
  values are numeric only (a date-only citation would drift by day), instants → one fixed instant, cost/token numbers
  kept as written (scripted usage is deterministic). Committed as `shared-test-fixtures/insight/exit-criterion.json`
  (ordered legs); the spec fails if the real routes' normalised output differs, and each response validates against its
  schema where one exists. Regenerate with `HEL1747_WRITE_FIXTURE=1`.
- helio-mcp `insightExitCriterion.test.ts` connects an MCP `Client` to `createServer` over `InMemoryTransport`
  (precedent `server.test.ts`). The fake `fetch` maps each placeholder to one concrete id for the whole test, answers
  ONLY the recorded legs in order and fails the test on any unrecorded or out-of-order request. Script: add_output
  (insight) → refresh_insight → get_output_insight (assert ≥1 citation whose id appears as `[cN]` in the markdown) →
  place_outputs (no `w`/`h`: a size hint adds an unrecorded auto-layout request) → ask_dashboard (assert cited answer, non-null pin) → add_output({pipelineId: pin.pipelineId,
  ...pin.request}). Each request body MCP sends is asserted equal to the recorded request body after substitution.
Alternative (boot the jar keyless) rejected: renders fail without a model, so no cited narrative.

**D8 Stale backend comment.** `OutputConfigValidation.scala:39-41` says the proposal surface does not accept insight
"until HEL-1747 (L8)". After this change MCP does; the in-app assistant still does not. Reword the comment to name the
in-app assistant proposal tools only (comment-only edit, no behavior change).

## Risks / Trade-offs

- [The fake backend can drift from the real one] → every fake body is a committed fixture the backend seam spec
  regenerates and asserts from the real routes; the MCP test refuses unrecorded requests.
- [Description text drifts from backend behavior] → descriptions cite only behavior stated in the schemas/CLAUDE.md;
  doc-assertion tests pin the load-bearing phrases.
- [The insight render is asynchronous in the seam spec] → `eventually` with an explicit patience polls for the `ok`
  row (existing refresh specs sleep; this one does not); `refresh: "manual"` rules out a second render.
- [One script shared by render and ask] → a call-count assertion fails if any extra model call consumes a turn.
- [Sibling lanes] → no file overlap with HEL-1772 (CI/e2e weights) or HEL-1773 (dashboard access/frontend shell).

## Migration Plan

None. Merging does not change the running session MCP or the hosted connector (owner prod steps).

## Planner Notes

- Shipped deviation (HEL-1747 cycle 1): `OutputKindDriftSpec` pinned the helio-mcp kind enums to the six pre-insight kinds
  ("HEL-1747 L8 owns them"), so it went red once they gained `insight`. The pins were replaced by a positive check that the
  `OUTPUT_KINDS` tuple equals `OutputKind.all`; the in-app assistant exclusions stay, relabelled as deliberate.
- Exit-criterion world (cycle 2): Revenue is a metric with a `previous_run` compare and two history points, so the insight
  pack carries Revenue's current value; both the seam spec and the MCP replay assert a narrative citation with Revenue's outputId.

- Self-approved: D3 (no trigger argument), D5 (single-source enum + drift test), D8 (comment-only backend edit), and
  no `get_output_insight_history`/`ask_output` tools. All are inside the ticket's scope or narrower than it.
- No Flyway migration; V146 not claimed.
- Driver claims verified against the tree: refresh route/rate-limit env (ApiRoutes.scala:353-360), R1 `config.model`
  (InsightConfig.scala), R3/R3b role shaping and ask's server model (CLAUDE.md API section).
