## Context

Paths are under `backend/src/main/scala/com/helio/`. Facts are at 8fff8eed1 and were verified by the round-1 design
skeptic (`skeptic-design-1.md`).

- **Pipeline read.** `get_resource(pipeline)` builds through `buildPipeline(summary, user)` with empty default maps,
  so `laneTree` is always `[]`. `steps` carry only names per position.
- **Dashboard read.** `get_resource(dashboard)` returns `{id, name, panelCount}`. `get_resource(Output)` has no
  `pipelineId`/`nodeStepId`. Nothing links dashboard → panel → Output → pipeline; the transcript reached the pipeline
  by name luck.
- **find** matches the whole query as one substring (`WorkspaceSearchService.matchesQuery` l.102).
- **Propose validation** (`PipelineProposalService.validate`):
  - It never runs `StepConfigValidation`, so `lookup {}` and an aggregate with no measures pass.
  - An Output id used as a root gives `data source not found`.
  - The unknown-type error lists all kinds, including non-authorable `join`/`groupby`.
- **Patch sets.**
  - Output create is rejected (`PatchSetApplyResolvers` l.~90).
  - `OutputService.create` checks config only. The fieldMapping-columns-at-node check
    (`PipelineServiceSupport.validateOutputFieldMapping`) runs only in `PipelineCreateTransaction` and
    `PipelineProposalAnalyze`.
  - HEL-670/914 texts say no edit may reference another edit's create and that output is "update only":
    - `RefinementPrompt` l.33-39
    - `RefinementEditShape.CreateExample`
    - `AssistantProposalToolSchemas.EditSchema`
    - `EditTargetSchema.parentId` ("currently only pipelineStep")
- **Tool loop.** `ClaudeClient.sendWithTools` runs one response's tool_uses concurrently (`Future.traverse`, l.125-150).
  `MaxHops = 4`.
- **Precedent for in-proposal references:** `propose_combined`'s `"$pipelineOutput"` and pipeline `clientId`s.

## Goals / Non-Goals

**Goals:**
- The Standings request yields one patch set: chart Outputs on the existing pipeline plus panels on the existing
  dashboard. It is preview-valid and really applies.
- Taxonomy items 1–7 and 9 are each fixed or given a stated won't-fix.
- Before/after measurements.

**Non-Goals:**
- HEL-1638: a general dry-run apply. Item 8 belongs there. The one exception is D2's own column check, which is part
  of making output create correct.
- HEL-1636, HEL-1637, HEL-721.
- Changing `MaxHops` or the model.
- New step ops.
- Expressing "a new pipeline plus panels on an existing dashboard" in one proposal. The ticket's alternative plan
  stays two proposals; this is stated in the PR.

## Decisions

**D0: probe first.**
- Replay the transcript's failing calls through `AssistantToolExecutor` against the D8 fixture. Record each exact
  error and its cause in `evidence/failure-taxonomy.md`.
  - Item 2's root `{sourceId,type}` error is already clear. Its 4× repeat came from fan-out, which is fixed by D5.
- Probe whether `analyzeNodes` projects a configured lookup's added column (`display_name`) at the lookup node. If it
  does not, the D1 node schemas and the D2 column check both need that fixed first. Report this before building on it.
- Any cause that differs from this design is reported, never silently re-designed.

**D1: reads (items 4, 6).**
- `getPipelineResource` passes this pipeline's own steps, roots and root-of-step maps (the `assemble` batch helpers,
  scoped to one id), so `laneTree` populates.
- Add `nodes`: in order, `{id, parentStepId, rootId, type, config, disabled, outputSchema:[{name,type}],
  validationError}`, from the analyze already called.
- Add `outputs`: `{id, name, kind, nodeStepId, fieldMapping}`, covering all Outputs.
- `get_resource(dashboard)` adds `panels:[{id, title, type, outputId, outputPipelineId}]`.
- `get_resource(Output)` adds `pipelineId` and `nodeStepId`.
- Credential-bearing config fields are redacted, and `CredentialSurfaceEnumerationSpec` is extended to cover them.
- **Contract surface (option i).** These additions use NEW `get_resource`-only response types, e.g.
  `PipelineResourceDetail`, `DashboardResourceDetail` and an Output detail. They wrap or extend the shared types by
  composition, in `WorkspaceSearchService` and its protocol.
  - The shared `WorkspaceContextPipeline`/`WorkspaceContextDashboard` types are NOT changed. Those back
    `GET /api/workspace/context`, the strict `schemas/workspace/workspace-context.schema.json`, the helio-mcp types and
    goldens, and the context-budget tests, so none of those surfaces change.
  - A test asserts the workspace-context JSON is byte-identical for a fixture before and after.
- `get_resource(pipeline)` stays owner-only, as today. D2 lets editors create Outputs through patch sets; the PR notes
  the asymmetry.

**D2: patch-set `output` create and `$ref` (items 5, 6).**
- Shape of an output create:
  - `target.parentId` = pipeline id (editor/owner check as for `pipelineStep` create).
  - `patch` = the create-Output request.
  - `nodeStepId` must be a step of that pipeline.
- At preview and apply, the resolver builds the node schema from the pipeline's SAVED steps. `nodeStepId` must name a
  saved step of that pipeline; an unknown step is an error.
  - It uses ALL saved steps with their `enabled` flag, exactly as `PipelineAnalyzeReads` does: shared `analyzeNodes`
    plus `resolveSecondarySourceSchemas`.
  - It does NOT copy `PipelineNodeReads.projectedSchemaAtNode`, which drops disabled steps (the HEL-913 7.2c
    regression). It also does not reuse `PipelineCreateTransaction`'s request-keyed input assembly, which keys by
    clientId.
  - Root and secondary source schemas are read with the PIPELINE OWNER's view, following the HEL-1516 precedent. An
    editor who does not own a source therefore never gets a false "column missing".
  - It then runs `validateOutputFieldMapping(kind, config, nodeSchema)`, extracted to a shared helper. The error names
    the column and the node.
  - **Preview/apply agreement.** An output create is rejected when the same patch set also creates, updates or deletes
    its node or any step upstream of it, or the pipeline itself: `edit N: an output create cannot target a node whose
    steps are edited in this patch set; propose the step edits first`. Preview and apply then evaluate the identical
    saved schema. Staged-overlay schemas are a non-goal.
  - The REST `POST /pipelines/:id/outputs` is deliberately left unchanged, to avoid a scope and behaviour change for
    UI drafts. The PR says so.
- Any create edit may carry `target.ref` (`^[a-z][a-z0-9_-]{0,31}$`, unique). A panel create's `patch.config.outputId`
  may be `"$ref:<ref>"` naming an EARLIER output create.
  - A dangling ref fails: `edit N: $ref:<x> does not name an earlier output create (refs: …)`.
  - Panel/Output kind compatibility uses the referenced create's kind.
- Apply creates in order during the existing forward walk and substitutes ids. Apply is a step-by-step walk with a
  compensating rollback (`PatchSetApplyRollback`), not a DB transaction.
  - Output creates use an `OutputService.create` variant that skips `triggerBackfill`. Backfill is triggered for each
    created Output only after the forward walk completes with no failure. A rolled-back set therefore never triggers
    one.
  - Undo inverts an output create to a delete.
- Reversal of HEL-670/914 wording. These texts are updated, and so is any test pinning "create is not supported for
  output":
  - `EditSchema` ("output (update only)")
  - `EditTargetSchema.parentId`
  - `RefinementEditShape.CreateExample`
  - the `RefinementPrompt` rule
- Decision: the refinement flow does NOT gain output create or `$ref`. Refinement edits one existing resource, so it
  keeps "never reference another edit's create". Its wording becomes accurate: "output create exists in patch sets
  but is not offered here".
- Contract and consumers updated: `schemas/patch-sets/patch-set.schema.json`, the frontend `patchSet.ts` types and
  preview, and the helio-mcp patch-set tool schema.

**D3: tool schemas and descriptions (items 1, 2, 3, 6).** Generated from code.
- Step `type` is an enum of `PipelineStepKind` filtered to authorable kinds.
- Per-op config schemas cover lookup, compute, select, cast, aggregate, filter, sort, rename and limit, with
  `additionalProperties:false`. The root and step objects are strict too. Other ops stay `object`.
- The first after-run eval converse (D8, inside C1) confirms the Anthropic API accepts the schema form.
- Compute description: the grammar summary plus 3 examples checked against the parser, e.g. `$wins + $ties * 0.5`,
  `round($settings.fpts + $settings.fpts_decimal / 100, 2)`. Use `+` for concatenation; drop `concat` unless the
  parser has it.
- Parity test:
  - The enum equals the authorable registry.
  - For each per-op schema, its example decodes and yields no `StepConfigValidation` problems.
  - Removing any schema-required key yields a non-empty problem list.
- `propose_dashboard` description: "always creates a NEW dashboard".
- `propose_patch_set` description: "the tool to add Outputs to an existing pipeline and panels to an existing
  dashboard".
- Panel create:
  - `target.parentId` is rejected with "use patch.dashboardId".
  - Panel-level `fieldMapping`/`aggregation` on an output panel is rejected with "chart shape belongs on the Output
    (kind + fieldMapping)". Applied per the D0 finding.

**D4: propose-time errors (items 3, 5).**
- `PipelineProposalService.validate` runs the full `StepConfigValidation.validate` per step: declared required keys
  plus the per-kind validators. The error is `step N ('lookup'): <problems>`.
- The unknown-type error lists authorable kinds only.
- An unknown root `sourceId` that is an Output the caller can read (owner/grant-scoped, no cross-tenant leak) gives:
  `roots[i]: '<id>' is an Output, not a data source. Outputs cannot be pipeline roots; add steps or Outputs to its
  pipeline <pipelineId> with propose_patch_set`.
- These checks are shared with MCP and HTTP proposals; the PR says so. The UI save path (HEL-950 drafts) is untouched.

**D5: one propose per response (item 7).**
- Enforced in `ClaudeClient.sendWithTools`, which is the only place that sees a whole response.
- Before `Future.traverse`, partition the response's tool_uses. The first `propose_*` in response block order runs.
  Each later `propose_*` in that same response gets a synthetic `isError` tool_result: `only one propose_* call per
  response is evaluated. A turn yields ONE proposal: put every edit (all Output creates and panel creates) in a
  single propose_patch_set call, and re-propose the whole set if it fails`.
- **Proposal model (unchanged, now stated).** `AssistantToolExecutor.capturedProposal` holds one proposal per turn, and
  each successful propose overwrites it. The design therefore never asks the model to "propose the rest" later in the
  same turn. The whole change is one proposal.
- The propose-name set is passed in by `AssistantService`, so `ClaudeClient` stays generic.
- Next-hop proposes are unaffected.
- Tests:
  - 4 proposes in one response: 1 runs, 3 errors.
  - A failed propose in hop N followed by a corrected propose in hop N+1: it runs.

**D6: find (item 9).**
- Tokenize the query: lower-case, split on non-alphanumerics, drop tokens shorter than 2 and a stop list (my, the, a,
  of, for, dashboard, pipeline, output, source, data).
- Match on any token in the name, or on the whole query as before. Rank by tokens matched.
- With no tokens left, fall back to the old behaviour.

**D7: prompt (items 1, 6, 7, 10).** Tight: at most the current length plus ~40 lines.
- The chain: source → steps (node schemas) → Output (kind + fieldMapping, at a node) → panel (outputId only).
- Outputs are not sources.
- Existing dashboard → `propose_patch_set`.
- Read the dashboard → its Output's pipeline → nodes. Map only columns in a node's `outputSchema`.
- Extend before you build. Make the whole change ONE proposal: for Standings, N output creates plus N panel creates
  in a single propose_patch_set. If it fails, fix and re-propose the whole set. Never one proposal per chart.
- Say "proposed", not "created".
- One worked example: the Standings patch set, with output creates carrying refs plus panel creates.

**D8: eval (AC 1, 5).**
- **Runner drives the lane's dev backend over HTTP** (skeptic-design-3 CR1). The test JVM deliberately gets neither
  `ANTHROPIC_API_KEY` nor `DATABASE_URL` (HEL-1450 `DevEnv.deniedTestKeys`), and `.env` must never be read. So the
  runner holds no key and no DB connection.
  - Location: a plain `main` object, `backend/src/test/scala/com/helio/eval/AssistantEval.scala`, run with
    `sbt "Test/runMain com.helio.eval.AssistantEval <baseUrl>"`. This follows the precedent of `RetentionTickMeasure`
    and `HistoryThinMeasure`.
  - It is not a ScalaTest suite, so `testFull` never discovers it. It refuses to start unless
    `HELIO_ASSISTANT_EVAL=1`.
  - Target: the lane's dev backend, started by `scripts/concertino/start-servers.sh`, which loads `.env` itself. The
    backend's port comes from that script's output.
  - HEL-1450 is not weakened, and there is no build change.
- **Account:** the tracked shared dev account (`matt@helio.dev`, the canonical evaluator account). The runner logs in
  over the normal auth route.
  - First step: confirm over the API that the account's tier may use chat (beta/owner).
  - If it may not, that is a BLOCKER to the driver. Never edit `.env` or tiers to work around it.
- **Fixture:** created over the public API under that account by the runner:
  - rosters CSV and users CSV, using the transcript's real columns;
  - pipeline **"Sleeper League Pipeline"**, pinned so the name contains no "Standings": lookup owner_id→user_id
    adding display_name, plus compute `points_for`;
  - Output "Standings Table";
  - dashboard "Standings".
  - Fixture ids are recorded, and cleanup deletes exactly those ids plus anything the eval's applies created.
- **Fresh, pinned backend (skeptic-design-4 CR1).** `start-servers.sh` reuses a healthy backend, so before EACH of the
  baseline and after runs:
  - stop the lane's servers with `scripts/concertino/stop-servers.sh <WT> <DEV_PORT> <BACKEND_PORT>`;
  - start them with `CLAUDE_MODEL=claude-haiku-4-5-20251001 LOG_FORMAT=json scripts/concertino/start-servers.sh ...`.
    `ClaudeConfig` reads the process env, and `DevEnv.runEnv` lets an exported variable win over `.env`.
  - Never reuse a backend started without those variables.
- **Each case** is one user message, sent through a new conversation's `POST .../converse`. Mutating requests carry
  `X-Helio-Requested-With: 1`; login is `POST /api/auth/login`; the tier comes from `/me`.
  - Failed calls and successful proposes are counted from the returned transcript's `tool_result.isError`. The
    proposal is recovered from the transcript (the propose input plus `proposalId`), as the frontend does.
  - The proposal is applied via `POST /api/patch-sets/preview` and `/apply`, or the proposal kind's own apply route.
  - The dev-account password is passed to the runner by environment variable or argument, never committed.
- **Usage, model and abort guard.**
  - The runner reads the conversation's JSON `assistant_tool_loop_outcome` line from `<WT>/.concertino-backend.log`,
    matched by `conversationId` (never by file position), and takes `modelId` and token counts from it.
  - Cost is computed from those tokens at Haiku 4.5 prices and accumulated against C1.
  - Abort guard: on the first case, if no JSON line is found or `modelId != claude-haiku-4-5-20251001`, the runner
    stops before any further model call.
  - If this proves impossible, the executor reports it at task 0.1. It never adds a usage field to the converse
    response, which would be an unplanned contract change.
- The tracked dev account's tier is checked first. A `beta` tier has a 50-messages-a-day cap that limits re-runs;
  reaching that cap is a BLOCKER, never worked around.
- **Schema-form check:** the D3 "Anthropic accepts the schema" check is simply the first after-run converse. A `400`
  from Anthropic there fails loudly.
- **Failed call** = a tool_result with `isError=true`, including decode errors and D5 rejections. A zero-result
  `find` is not a failure; it is counted separately.
- Successful propose calls are counted from the transcript (non-error propose tool_results); no new counter.
- **Standings pass** requires all of:
  - exactly one SUCCESSFUL propose call (a failed propose followed by one corrected success counts as one);
  - the proposal previews ok;
  - a real apply succeeds;
  - no hop-budget exhaustion;
  - at most 2 failed calls.
- Cases: Standings, plus 4 fixed before the baseline:
  - a chart from a raw CSV;
  - a line chart added to an existing dashboard;
  - top-N via aggregate/sort/limit;
  - a compute column.
- Baseline on the branch-point code, then after on the final code.
- Results go to `evidence/eval-results.md`: per case, calls, failed calls, zero-result finds, proposals, preview ok,
  applied, hops used, tokens, cost.
- Cost: Haiku 4.5 at $1/$5 per Mtok, about 4 hops × ~20k input + ~2k output per hop, so about $0.15 per case-run.
  5 cases × 2 is about $1.50. **C1 cap is $3**: the runner tracks usage and stops before exceeding it.
- **If the after-run fails Standings** — on the 4-hop limit or anything else — the AC is UNMET. The lane raises an
  ESCALATION to the owner; it never ships the result as a recorded miss.

## Risks / Trade-offs

- n=1 per case is noisy. Report it as n=1. A second sample is allowed inside C1.
- Strict schemas could reject configs the decoders accept. The parity and round-trip tests mitigate this.
- HEL-1652 overlap: D4 touches `PipelineProposalService`. Report overlapping files.

## Planner Notes

- Self-approved: D2. The ticket says "scope it or file a follow-up", and the skeptic confirmed it is minimal and
  follows the `$pipelineOutput` precedent. Flagged to the driver.
- Self-approved: the $3 live budget, inside the driver's "a few dollars".
- Refinement keeps no `$ref` (D2).
- Item 8 → HEL-1638. Item 10 → a prompt line only.
- Prod model `claude-haiku-4-5-20251001`.
