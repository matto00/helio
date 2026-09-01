# HEL-907: P1.4 — helio-mcp + proposals: Output tools, single-call create_pipeline, slim workspace context, per-node grounding, review pages

## Description

Row P1.4 of epic HEL-903 (Pipelines & Outputs remodel). Spec section
*Agent / MCP surface & proposals*, decisions 10, 11 —
`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` on
`main` WINS over this ticket wherever they disagree; correct the ticket, do
not follow it blindly.

Merged predecessors on `main`: P1.1 HEL-904 (`2ec2a5bc`), P1.2 HEL-905
(`666db9f8`), P1.3 HEL-906 (`cc4cf679`), plus rows 0a-0e (HEL-330/842/725/720,
HEL-797).

helio-mcp has 58 tools; `dataTypeId` threads through
`helio-mcp/src/tools/{write,read,proposal,combinedProposal,proposalValidation,pipelineProposal,pipelineProposalHandlers,refinement,updateSchemas,metricSchemas,scheduleTools}.ts`
and `helio-mcp/src/{index,helioApi,types,context}.ts`. `metricSchemas.ts` is
deleted outright. Backend proposal services (`DashboardProposalService`,
`PipelineProposalService`, `CombinedProposalService`, patch sets) ground
panels against a DataType schema today. The Sleeper build (HEL-857) hit the
MCP token cap on `get_workspace_context` at 220k characters.

### WHAT P1.3 JUST GAVE US (build on, don't re-derive)

- `POST /api/pipelines` single-call create (source + steps with
  `parentStepId` + outputs) in ONE real Slick transaction on the
  RLS-enforced pool. `create_pipeline` tool maps onto this.
- `POST /api/pipelines/:id/preview` with optional `outputId`; both arms
  return the same envelope `{outputs: [{outputId, preview}]}`.
  `preview_outputs(pipelineId, outputId?)` maps onto this.
- `GET /api/outputs/:id/rows` (paginated) -> `get_output_rows`.
  `GET /api/pipelines/:id/capabilities?stepId=` -> `get_output_capabilities`.
  `GET /api/outputs/:id/assertion-status`,
  `POST /api/pipelines/:id/validate-expression?stepId=`,
  `GET /api/outputs` (lean paginated).
- TWO BREAKING wire changes to absorb: `POST /api/pipeline-shapes/:id/expand`
  returns `{steps, outputs?}` instead of a bare array, and
  `DELETE /api/pipeline-steps/:id` returns 200-with-body instead of 204.
  HEL-934 tracks updating stale frontend/e2e/helio-mcp consumers — the
  helio-mcp share of that is OURS; close it here and note it in HEL-934.
- spray-json omits `Option = None` (never writes `null`). Any TS client
  written here must treat these keys as possibly ABSENT (`outputs?`,
  `nodeStepId?`, `parentStepId?`), never `=== null`. Test with the field
  absent.

### This ticket's own traps (verify each)

Owns BOTH sides of the proposal and patch-set contracts —
`schemas/dashboards/dashboard-proposal`, `schemas/pipelines/pipeline-proposal`,
`schemas/patch-sets/*`, the backend proposal services, AND helio-mcp's
`proposal.ts`/`combinedProposal.ts` — because `check-schema-drift.mjs:20-32`
reads backend and MCP files together. P1.3 deliberately left them untouched
across all 13 of its cycles; that was an AC of P1.3, not an oversight. Now
they are ours, both sides in one change.

When splitting `WorkspaceContextService`, do NOT alter `asNumeric`'s
single-exit-filter structure or its `BigDecimal.setScale` rounding — settled
after four rounds on HEL-373. Moving code is fine, changing it is not.

### Hard-won lessons from this batch (front-loaded)

1. A green gate is not evidence until you check what it scans. CORRECTED
   TWICE at Planning time (design-gate skeptic rounds 1 and 2, both verified
   directly against this worktree). The real trap: `jest.config.cjs`
   excludes `/.claude/worktrees/` from both `testPathIgnorePatterns` and
   `modulePathIgnorePatterns` (deliberately, so in-flight deliveries don't
   collide) — so root `npm test`, run from *inside* a delivery worktree like
   this one, finds and silently passes on ZERO helio-mcp tests. Neither root
   `npm test` nor `npm --prefix helio-mcp test` (no such script) works. The
   verified command, run every cycle, confirmed green for real (250 tests /
   14 suites / ~4s / no OOM / `write.test.ts` included):
   `cd helio-mcp && npx jest --rootDir . --config '{"preset":"ts-jest","testEnvironment":"node","testMatch":["**/?(*.)+(spec|test).[tj]s?(x)"],"moduleNameMapper":{"^(\\.{1,2}/.*)\\.js$":"$1"},"testPathIgnorePatterns":["/node_modules/","/dist/"]}'`.
   This is what actually proves HEL-647's OOM fix, not just "did some tests
   run". Also
   `check:no-credential-leak` never scans test resources (HEL-927) and
   `check-schema-drift.mjs` never reads `.scala` tool schemas (HEL-928).
2. Fix classes, not instances. When the same defect shape appears twice,
   enumerate the class exhaustively (construction/call sites, not string
   literals) before calling it fixed.
3. The backend suite is flaky under parallel execution (HEL-924). Never
   report a raw failure count as a verdict; classify by isolation. Prefer
   `sbt -batch 'set Test/parallelExecution := false' test`.
4. A deferral is only real if it names a task that exists and a ticket that
   owns it. Unfiled deferrals, `[x]` boxes marked "(partial)", comments
   asserting the opposite of their code, and citations to nonexistent
   specs/tests have all appeared in this batch. Read the comment above a bug
   before fixing it.
5. "No wire impact" != "no downstream impact." HEL-910's final sweep greps
   `com\.helio\..*DataType`, `DataTypeId`, `MetricDefinition`, `MetricId`,
   `type_id`, `dataTypeId`, `metricId`, `/registry`, `/metrics`,
   `computed_fields`, `@deprecated`. This ticket must leave no hits in its
   own new/changed code.
6. Test what a claim actually asserts. A case-class assertion cannot prove a
   wire shape; a preview test that never runs the absent-arg arm proves
   nothing about it.

## Scope — helio-mcp

- Changed: `create_pipeline` (sourceId OR inline source spec; optional
  `steps[]` with `parentStepId`; optional `outputs[]` — one call builds
  everything); `add_pipeline_step` gains `parentStepId`;
  `create_pipeline_from_shape` -> `add_outputs_from_shape(pipelineId, stepId?, shape, params)`;
  `create_panel`/`create_panels`/`bind_panel`/`create_bound_panel` ->
  `place_outputs(dashboardId, [{outputId, title?, w?, h?}])` +
  `create_content_panel`; `update_panel` keeps placement fields only;
  `get_panel_capabilities` -> `get_output_capabilities(pipelineId, stepId?)`;
  `get_workspace_context` drops types and metrics and lists pipelines with
  their outputs (kind, schema, placements) and sources with
  `inferredSchema`.
- New: `add_output`, `update_output`, `delete_output`, `list_outputs`,
  `get_output_rows` (replaces `get_data_type_rows`),
  `preview_outputs(pipelineId, outputId?)`.
- Removed (no aliases): `list_data_types`, `update_data_type`,
  `delete_data_type`, `get_data_type_rows`, `list_metrics`, `get_metric`,
  `create_metric`, `update_metric`, `delete_metric`, `bind_panel`,
  `create_bound_panel`, `get_panel_capabilities`.
- `teardown_resources` and tag semantics cover Outputs (an Output inherits
  its pipeline's tag).
- Decompose `write.ts`/`helioApi.ts`/`context.ts` by resource while being
  rewritten (absorbs HEL-882, HEL-658, HEL-648); fixes the root Jest/ts-jest
  OOM on importing `write.ts` (HEL-647, cancelled into this ticket — an AC,
  not optional).
- Same-tab invalidation (`markDataTypeRowsStale`, HEL-242) re-keyed by output
  id. SSE registry (HEL-641) and BroadcastChannel (HEL-640) are NOT absorbed
  here — retargeted as their own tickets, blocked on P1.7.
- `replace_dashboard_contents`/`auto_layout_dashboard`
  (`DashboardContentsService`, rewired in P1.1) accept placements
  (`outputId`) instead of bindings.

## Scope — Backend proposals

- Owns both sides of proposal + patch-set contracts (see traps above).
  `DashboardProposal`/`PipelineProposal`/combined/patch-set schemas and
  services re-target: a proposal proposes a pipeline (steps + outputs) and a
  dashboard (placements + content panels). Validation grounds each Output's
  `fieldMapping` against the projected schema at its node
  (`PipelineAnalyzeService` per node, from P1.2).
- Split `WorkspaceContextService` while rewriting it (absorbs HEL-631) — see
  `asNumeric` caution above.
- Patch-set inverse builders rewritten for nodes/outputs/placements;
  `PipelineStep.enabled` survives rollback/recreate — the real HEL-766
  defect is `PatchSetApplyRollback.scala`'s step inverse builders omitting
  `enabled`, not any `Output.enabled` (Outputs have no such field) (absorbs
  HEL-766).
- Refinement targeting: a chart-create with an implied Output must not
  mistarget a follow-up edit (re-verify HEL-670 against the new model; add
  regression test).
- Review pages (`ProposalReviewPage`, patch-set, pipeline-proposal, combined)
  render Output previews instead of "panel bound to type X"; close the two
  HEL-829 loose ends in the rewrite (absorbs HEL-848).
- propose -> review -> apply boundary unchanged: apply is never a tool in
  the in-app assistant.

## Acceptance Criteria

- [ ] MCP E2E: the four Sleeper dashboards (HEL-857) rebuild from the live
      API through `create_pipeline` (single call each) + `place_outputs`,
      from a clean workspace, with a daily schedule read back. Script
      committed under `e2e/` or `helio-mcp/e2e/`, runnable against a dev
      backend.
- [ ] `get_workspace_context` for a 25-source/43-pipeline workspace fixture
      is under the MCP result cap; HEL-865 updated to say what remains.
- [ ] Removed tools are absent from the tool list (test asserts the exact
      tool-name set).
- [ ] Proposal grounding test: an Output on a tail is validated against the
      tail's projected schema, not the trunk's.
- [ ] Patch-set undo test covering add/remove/modify of a PipelineStep
      (`enabled` preserved through rollback/recreate — the real HEL-766
      target) and of a placement (its own enabled-equivalent field, if any,
      preserved).
- [ ] helio-mcp typecheck is gated (HEL-797, already merged); the verified
      scoped helio-mcp jest command (see Hard-won lessons #1 above) imports
      every decomposed module without OOM (HEL-647) — root `npm test` does
      NOT exercise helio-mcp inside this worktree and is not acceptable
      evidence for this AC.
- [ ] `check-schema-drift.mjs` green with proposal + patch-set schemas and
      both service sides changed together.
- [ ] `teardown_resources` by tag removes a pipeline's Outputs and their
      placements (backend branch rewired in P1.1; tool + test here).
- [ ] `docs/agent-native.md` carries the tool rename table (the only
      compatibility artifact, decision 11).
- [ ] HEL-934's helio-mcp-side consumers of the breaking `expand` envelope
      and `DELETE /api/pipeline-steps/:id` response are updated and closed
      out here (comment on HEL-934 confirming the helio-mcp share is done).

## Out of Scope

Frontend pipeline page and dashboard picker (P1.5/P1.6); branching in
proposals (P2.4).

## Dependencies

Blocked by P1.3 (HEL-906, merged) and 0e (HEL-797, merged). Blocks P1.5
(HEL-908) and P1.7 (HEL-910).

## Delivery notes for this run

- Agent-merge is ENABLED for this run. After PR creation, spawn
  `concertino-auditor` (model sonnet). Never `gh pr merge --auto` — poll
  `gh pr checks` to terminal, verify via
  `gh pr view --json statusCheckRollup`, then squash-merge manually.
  `check-merge-readiness.sh` false-positives on the SKIPPED
  Dependabot-only `label-update-type` workflow — treat that specific
  SKIPPED check as non-blocking.
- Models: orchestrator=sonnet, executor=sonnet, evaluator=opus, skeptic=opus,
  auditor=sonnet. Pass `model` explicitly on every Agent spawn call.
- Final gate = dimension-split fan-out: parallel opus skeptics, one report
  each, counting as ONE collective round. Dimensions: (1) MCP tool surface +
  removals, (2) proposal/patch-set contract both-sides consistency,
  (3) deletion-sweep against HEL-910's grep list, (4) wire-contract diff.
  Brief each skeptic that a green gate is not automatically evidence.
- UI gate is N/A (backend/MCP only) — state this explicitly, do not skip
  silently.
- Design-gate budget: 5 rounds. Execution cycles: not hard-capped, but flag
  if running long.
- Escalate only for: a genuine design question, data-loss/security risk, or
  anything expensive to reverse after merge. Everything else: decide and
  keep moving. The run continues into P1.5-P1.7 unattended afterward.
