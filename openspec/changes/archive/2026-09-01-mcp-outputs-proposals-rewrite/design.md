## Context

`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` on
`main` is the authoritative source for the Outputs model (decisions 1-9) and
the Agent/MCP surface + proposals section (decisions 10-11) this ticket
implements; it wins over the ticket text wherever they disagree. P1.1-P1.3
already shipped: `outputs`/`node_snapshots`/`parent_step_id` tables and
migration (HEL-904), tree-walk engine with per-node dry-run previews
(HEL-905), and the API surface — `POST /api/pipelines` single-call create,
`POST /api/pipelines/:id/preview?outputId=`, `GET /api/outputs/:id/rows`,
`GET /api/pipelines/:id/capabilities?stepId=`,
`GET /api/outputs/:id/assertion-status`,
`POST /api/pipelines/:id/validate-expression?stepId=`, `GET /api/outputs`
(HEL-906). `data_types`/`metrics` tables are already dropped.

helio-mcp today (`helio-mcp/src/tools/`) still speaks DataType/Metric/panel
binding: `write.ts` (~2800+ lines per HEL-882/658) holds the bulk of the
mutating tools and is the file causing the Jest OOM on import (HEL-647).
Backend proposal services (`DashboardProposalService`, `PipelineProposalService`,
`CombinedProposalService`) and `schemas/dashboards/dashboard-proposal.schema.json`,
`schemas/pipelines/pipeline-proposal.schema.json`, `schemas/patch-sets/*`
still ground panels against a DataType schema — P1.3 explicitly left these
untouched.

## Goals / Non-Goals

**Goals:**
- Retarget every helio-mcp tool onto Outputs; remove DataType/Metric/panel-
  binding tools with no aliases (decision 10's exact tool table).
- Decompose `write.ts`/`helioApi.ts`/`context.ts` by resource as part of the
  rewrite, fixing the root Jest OOM (HEL-647) as a structural byproduct, not
  a separate patch.
- Retarget both sides of the proposal/patch-set contract (schemas + backend
  services + MCP `proposal.ts`/`combinedProposal.ts`) onto pipelines
  (steps+outputs) and dashboards (placements+content panels) in one change,
  since `check-schema-drift.mjs` reads both sides together.
- Ground Output `fieldMapping` validation against the per-node projected
  schema (`PipelineAnalyzeService`), not the trunk's.
- Keep `get_workspace_context` under the MCP result cap for a realistic
  fixture (25 sources / 43 pipelines).

**Non-Goals:**
- Any frontend pipeline-page or dashboard-picker UI (P1.5/P1.6) beyond the
  proposal review pages this ticket must touch to stay consistent with the
  new contract.
- Branching in proposals (P2.4).
- Building the SSE registry (HEL-641) or BroadcastChannel (HEL-640) — those
  stay their own tickets, blocked on P1.7; this ticket only re-keys the
  existing same-tab `markDataTypeRowsStale` invalidation by output id.
- Changing `asNumeric`'s single-exit-filter structure or `BigDecimal.setScale`
  rounding in `WorkspaceContextService` — moving code during the split is
  fine, altering this logic is not (HEL-373, settled after four rounds).

## Decisions

1. **Tool rewrite via decomposition, not a giant patch to `write.ts`.**
   Split `write.ts`/`helioApi.ts`/`context.ts` into resource-scoped modules
   (e.g. `tools/outputs.ts`, `tools/pipelines.ts`, `tools/placements.ts`,
   `helioApi/outputs.ts`, `helioApi/pipelines.ts`, `context/outputs.ts`) as
   part of writing the new tools, so each new/changed tool lands in a
   right-sized file from the start rather than growing `write.ts` further.
   This is what actually fixes HEL-647 (root Jest OOM importing `write.ts`
   as one huge module) — verify using the scoped `helio-mcp` jest command
   documented in the Risks section below (root `npm test` does not exercise
   helio-mcp inside a delivery worktree at all) and confirming every
   decomposed module imports cleanly.
2. **`create_pipeline` single call maps onto P1.3's `POST /api/pipelines`,
   with a documented gap in the inline-source arm.** Verified against
   `schemas/pipelines/create-pipeline-request.schema.json`: the route
   requires `sourceDataSourceId` and has `additionalProperties: false` — it
   does NOT accept an inline source spec in one call, only a `sourceId`
   (the schema calls it `sourceDataSourceId`). The MCP tool still presents a
   single **agent-facing** call, per decision 10, by doing the inline-source
   work itself: when given an inline source spec, `create_pipeline` first
   issues `POST /api/data-sources` to create it, then
   `POST /api/pipelines` with the resulting id as `sourceDataSourceId` —
   two HTTP calls under the hood, one MCP tool call from the agent's
   perspective. If the second call fails, the tool reports the created,
   now-orphaned data source id in its error so the agent (or a human) can
   clean it up via `delete_data_source` / `teardown_resources` — this is not
   silently swallowed. `steps[]` carries `parentStepId` for tree shape;
   `outputs[]` is optional (a pipeline can be created with zero outputs and
   outputs added later via `add_output`). No backend schema change is
   needed under this approach; if a future ticket wants a true one-
   transaction inline-source create, that is backend scope, not this
   ticket's.
3. **`preview_outputs(pipelineId, outputId?)` is one tool over one route.**
   P1.3's `POST /api/pipelines/:id/preview?outputId=` already returns the
   identical `{outputs: [{outputId, preview}]}` envelope for both arms — the
   MCP tool passes `outputId` through unchanged; no branching logic needed
   client-side.
4. **Proposal/patch-set retarget is one change, both sides, per
   `check-schema-drift.mjs:20-32`.** Schemas
   (`schemas/dashboards/dashboard-proposal`, `schemas/pipelines/pipeline-proposal`,
   `schemas/patch-sets/*`), backend proposal services, and MCP
   `proposal.ts`/`combinedProposal.ts` are edited together in each execution
   cycle that touches any of them — never split across cycles in a way that
   leaves the drift check red mid-flight for more than one cycle.
5. **Per-node grounding reuses `PipelineAnalyzeService` from P1.2 for
   step-targeted Outputs, and the source's own `inferredSchema` for
   source-attached Outputs.** Verified against `output.schema.json`:
   `nodeStepId` is legal as `null` (an Output attached directly to the
   pipeline's source, not to any step). `PipelineAnalyzeService.analyzeNodes`
   deliberately omits the source itself from its per-node map — it only
   covers steps — so a source-attached Output's `fieldMapping` cannot be
   validated through `analyzeNodes`. Grounding for that case instead uses
   the source's `inferredSchema` directly (already computed by schema
   inference, per `sources`/`schema-inference` capabilities), bypassing
   `analyzeNodes` entirely for `nodeStepId: null`. The regression test (AC:
   "Output on a tail validated against the tail's projected schema, not the
   trunk's") covers the step-targeted case; a second test covers a
   source-attached Output validating against `inferredSchema`.
6. **`get_workspace_context` slims by dropping types/metrics entirely and
   summarizing pipelines by their outputs** (kind, schema, placements) and
   sources by `inferredSchema`, rather than truncating existing DataType
   listings — the 220k-char overflow (HEL-857) was caused by DataType/Metric
   enumeration that no longer exists in the target model, so the new shape
   is expected to be well under cap without a separate truncation strategy;
   verify against the 25-source/43-pipeline fixture as the AC requires, and
   update HEL-865 to say what (if anything) still needs a concise mode.
7. **HEL-766's real target, verified against the code, is `PipelineStep.enabled`,
   not any `Output.enabled`** — `Output` has no `enabled` field anywhere
   (not in the domain model, `OutputResponse`, `CreateOutputRequest`, or
   `schemas/outputs/output.schema.json`, which is `additionalProperties:
   false` without it). The live defect is in
   `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyRollback.scala:281-289`:
   both `fullPipelineStepInverse(prior: PipelineStep)` and
   `pipelineStepCreateRequestFromPrior(prior: PipelineStep)` build their
   request objects without setting `enabled`, so it falls through to
   `CreatePipelineStepRequest.enabled: Option[Boolean] = None`'s own
   default — not a compile error (that field has a default value, so
   omitting it compiles cleanly; the earlier claim that a missing value
   would be "a compile error" was wrong and is corrected here). The actual
   fix: both builders must explicitly set `enabled = Some(prior.enabled)`
   (or the equivalent non-Option field, matching `PipelineStep`'s own type)
   so a rollback/recreate carries the step's true prior `enabled` state
   instead of silently taking the default. Round-5 design-gate review found
   a second, worse defect in the same two lines:
   `pipelineStepCreateRequestFromPrior` also omits `parentStepId`, which
   under the HEL-904 tree model silently reparents a recreated step —
   structural tree corruption, not just a lost boolean. Both fields must be
   threaded explicitly (`enabled = prior.enabled`,
   `parentStepId = prior.parentStepId`) in the same fix. Placement `enabled`
   (if placements carry the field — verify against the actual placement
   model during execution) follows the same pattern: thread the prior value
   explicitly, never rely on a default.
8. **Removed tools are deleted, not deprecated-and-aliased** (decision 10 is
   explicit: "no aliases"). The exact-tool-name-set test (an AC) is the
   backstop against a stray tool registration surviving the tool-file
   decomposition.

## Risks / Trade-offs

- **Scope size.** This is the largest single ticket in the P1 sequence —
  near-total rewrite of `helio-mcp/src/tools/` plus both sides of the
  proposal/patch-set contract. Mitigated by decomposing into small,
  resource-scoped files/tasks (see tasks.md) so each execution cycle has a
  bounded, testable unit rather than one monolithic diff.
- **Root Jest suite coverage inside a delivery worktree — verified twice,
  corrected twice.** Round 1 wrongly claimed root `npm test` covers
  helio-mcp inside this worktree. Round 2 (design-gate skeptic) found the
  real trap: `jest.config.cjs`'s `testPathIgnorePatterns` (and
  `modulePathIgnorePatterns`) explicitly excludes `/.claude/worktrees/` —
  deliberately, so one worktree's in-flight tests don't run alongside
  another's — which means root `npm test` run *from inside a delivery
  worktree* finds and runs **zero** helio-mcp tests and exits 0 vacuously
  (`--passWithNoTests`). Verified directly: `npx jest --listTests` from this
  worktree's root returns nothing; overriding `testPathIgnorePatterns`
  alone still leaves `modulePathIgnorePatterns` excluding the worktree from
  the module map, so tests found that way fail to resolve modules at
  runtime. The command that actually works, verified by running it for
  real (250 tests, 14 suites, all green, ~4s, no OOM, `write.test.ts`
  included): a scoped jest invocation run from inside `helio-mcp/` with an
  inline config carrying no worktree exclusions at all —

  `cd helio-mcp && npx jest --rootDir . --config '{"preset":"ts-jest","testEnvironment":"node","testMatch":["**/?(*.)+(spec|test).[tj]s?(x)"],"moduleNameMapper":{"^(\\.{1,2}/.*)\\.js$":"$1"},"testPathIgnorePatterns":["/node_modules/","/dist/"]}'`

  Every execution cycle runs this exact command (not root `npm test`, not
  `npm --prefix helio-mcp test` — neither works) and treats its result as
  authoritative for helio-mcp coverage, including confirming it stays green
  with no OOM after the `write.ts`/`helioApi.ts`/`context.ts` decomposition
  (HEL-647).
- **Backend suite flakiness under parallel execution (HEL-924).** Use
  `sbt -batch 'set Test/parallelExecution := false' test` and classify
  failures by isolation rather than reporting a raw count.
- **HEL-934's helio-mcp share (breaking `expand` envelope + 200-body
  `DELETE /api/pipeline-steps/:id`)** is folded into this ticket's own MCP
  rewrite rather than a separate pass, since every touched call site is
  being rewritten anyway; the executor closes out HEL-934's helio-mcp
  checklist item explicitly (comment on HEL-934) rather than leaving it
  implicit.

## Planner Notes

- Self-approved: folding HEL-934's helio-mcp-side consumer updates into this
  ticket's own rewrite rather than treating it as a separate follow-up,
  since every helio-mcp call site touching `expand` or step-delete is being
  rewritten here regardless — doing it twice would be pure waste. Filing a
  distinct escalation for this was judged unnecessary; it's explicitly
  called out in the user's own delivery brief.
- Self-approved: no new backend routes are being added by this ticket — the
  MCP surface is a client of P1.3's existing routes. If the executor finds
  a genuine gap (a capability the ticket implies but no P1.3 route
  supports), that is a design question worth escalating rather than
  self-approving a new route.
