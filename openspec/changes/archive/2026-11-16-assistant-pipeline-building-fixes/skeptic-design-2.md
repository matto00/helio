## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7. The planning artifacts are untracked in the change dir.
Paths are relative to `backend/src/main/scala/com/helio/` unless noted.

### Round-1 change requests: are they resolved?

- **CR1 (false OutputService reuse claim): substantively resolved, but the new reuse claim is imprecise (see new CR2).**
  - The design now says correctly that `OutputService.create` checks only the config.
  - It routes the column check through `validateOutputFieldMapping` against a resolved node schema.
  - It adds the D0 lookup-projection probe (task 0.4).
  - It decides the REST route stays unchanged, and the PR will say so.
- **CR2 (where one-propose-per-response is enforced): resolved.**
  - `ClaudeClient.sendWithTools` (`infrastructure/ai/ClaudeClient.scala` l.90-142) builds `toolUses` with
    `blocks.collect`, which keeps the response block order. It then runs `Future.traverse(toolUses)(executeTool...)`.
    A partition before the traverse is well defined.
  - It is also the only caller site: `AssistantService.scala` l.94 is the only call.
  - `ClaudeToolRequest` (`infrastructure/ai/ClaudeModels.scala` l.150) can take a propose-name set field without
    touching other callers, because it has default params.
  - The hop N / hop N+1 test is specified.
  - **Caveat:** the D5 error text creates a new contradiction. See new CR1.
- **CR3 (discovery gap): resolved in intent.**
  - Dashboard panels carry `outputId` and `outputPipelineId`. The Output carries `pipelineId` and `nodeStepId`.
  - A spec scenario covers this.
  - The fixture pipeline name is pinned to "Sleeper League Pipeline".
  - **Caveat:** the revision leaves out the contract surface this touches. See new CR3.
- **CR4 (HEL-670/914 reversal): resolved.**
  - All four texts are listed.
  - The refinement decision is explicit: no `$ref`, and the wording is corrected.
  - Task 1.12 covers the rewording. Task 3.6a covers updating the tests that pin the rejection.
- **CR5 (eval measurement): resolved.**
  - "Failed call" is defined, and a zero-result find is counted separately.
  - The pass conditions are enumerated.
  - An after-run miss, the 4-hop limit included, triggers ESCALATION, never a recorded miss.
  - Cost check: $1/$5 per Mtok, about 4 x 20k in plus 2k out per hop, is roughly $0.12-0.15 per case-run. That
    makes about $1.50 for 5 x 2, under the $3 cap.
  - **Caveat:** "exactly one captured proposal" is not measurable as written. See new CR1.

### New factual claims, checked against the tree

- **"Partition by response block order in sendWithTools": TRUE.** Evidence is under CR2 above.
- **"Resolve the node schema the way `PipelineCreateTransaction` does": PARTIALLY TRUE.**
  - The primitives (`PipelineAnalyzeService.analyzeNodes` plus `resolveSecondarySourceSchemas`) are shareable.
  - The input assembly in `services/pipelines/PipelineCreateTransaction.scala` l.51-73 is not. It builds
    `NodeStepInput`s from the request's `req.steps` (clientId keys) and from `sourceSchemasByRoot` keyed by root
    index. An Output create on an existing pipeline needs a persisted-step assembly instead.
  - Two persisted assemblies already exist, and they disagree:
    - `PipelineNodeReads.projectedSchemaAtNode` (l.187-231) filters out disabled steps before the walk. That is the
      exact regression HEL-913 7.2c fixed in `PipelineAnalyzeReads` (l.106-125). It also reads root schemas with
      `findByIdOwned(dsId, user)`, so an editor grantee who does not own the source gets an empty schema.
    - `PipelineAnalyzeReads` passes every step with `enabled`. Per its HEL-1516 note it keeps the caller's view for
      projections.
  - Patch-set preview uses `PatchSetPreviewOverlay` (`services/patchsets/PatchSetPreviewOverlay.scala` l.31-62),
    which stages step edits (`withStep`). A preview-time column check that reads persisted steps ignores a same-set
    step update to the node or an upstream step. At apply time the forward walk has already persisted earlier
    edits, so preview and apply can disagree.
  - The design leaves all three choices unstated.
- **"triggerBackfill can be deferred until the whole set commits": FEASIBLE, but the mechanism is misdescribed.**
  - Patch-set apply is not a DB transaction. It is a forward walk through service methods with a reverse-order
    compensating rollback (`PatchSetApplyRollback.scala` l.20-55).
  - `OutputService.create` (`services/pipelines/OutputService.scala` l.124-170) calls `triggerBackfill`
    unconditionally after `insertInternal`, as a fire-and-forget (l.63-80).
  - Deferring it needs a create variant without backfill, or a flag, and then a post-walk trigger. That is
    achievable. "After the forward walk completes with no failure" is the accurate wording; "commits" is not.
  - The existing patch-set `output` update path already backfills mid-walk, so deferring here goes beyond current
    practice. That is fine.
- **"build.sbt can exclude a tag from testFull": TRUE in principle, but "BOTH tag included AND env var" does not
  compose as written.**
  - `Test / testOptions += Tests.Argument(ScalaTest, "-l", <tag>)` would also apply to `testOnly`.
  - In ScalaTest an excluded tag (`-l`) wins over an included one (`-n`). So "include the tag" cannot re-enable the
    suite unless the exclusion is itself conditional, for example on the env var. That collapses the two gates into
    one.
  - Alternatives: make the runner a `Test / runMain` object, not a Suite, or use a separate sbt config.
  - The env-var gate inside the runner is the real safety either way. Non-blocking, but the implementer should not
    be surprised by it.
- **D1 "the analyze already called": TRUE.** `WorkspaceContextService.buildPipeline` (l.272-300) already calls
  `pipelineService.analyze`, and `assemble` already has the batch maps.

### Verdict: REFUTE

### Change Requests

1. **D5 / D7 / D8: reconcile "propose the rest" with the single-slot proposal capture.**
   - The problem:
     - `AssistantToolExecutor.capturedProposal` (`services/assistant/AssistantToolExecutor.scala` l.63-71) is one
       `AtomicReference[Option[...]]`, overwritten on every successful propose. `AssistantService` surfaces only
       `executor.proposal` (l.152-167).
     - The existing prompt already says "Call at most one propose_* tool per turn"
       (`AssistantSystemPrompt.scala` l.101).
     - D5's error text says "fix and validate one proposal, then propose the rest". D7 says "Validate one proposal
       before you fan out". An agent that obeys either one, by proposing again in a later hop, silently replaces its
       first proposal. The user then sees only the last one, and each fan-out costs a hop out of 4.
     - D8's pass condition "exactly one captured proposal" cannot be measured: capture is at most one by
       construction.
   - Required:
     - State the per-turn model: one proposal per turn, and it must carry every edit. For Standings that is N output
       creates plus N panel creates in a single patch set.
     - Reword the D5 error and the D7 decision procedure to match. For example: "only one propose_* call per
       response is evaluated; put all changes into one proposal, fix it if it fails, and re-propose it".
     - Redefine the D8 pass as "exactly one SUCCESSFUL propose_* call in the turn (count successes, not the capture
       slot), and that captured proposal previews and applies".
     - Add an eval counter for successful proposes if none exists. `proposeAttempts` and the failure counters exist
       (l.84-95); successes do not.

2. **D2: specify the node-schema assembly for an output create on an existing pipeline.**
   - Replace "the way `PipelineCreateTransaction` does" with the actual source of the inputs, and decide each of:
     - (a) Build `NodeStepInput`s from ALL persisted steps, carrying `enabled`, as `PipelineAnalyzeReads` does. Do
       not use `PipelineNodeReads.projectedSchemaAtNode`'s pre-filtered, caller-owned variant.
     - (b) Choose whose view the root schemas are read with. Under the caller's view, an editor grantee whose
       pipeline reads a source they don't own gets an empty schema and a spurious "column missing". The pipeline
       owner's view is the likely answer, given HEL-1516's precedent.
     - (c) At preview, does the check run against `PatchSetPreviewOverlay`-staged steps, so that a same-set step
       update is reflected? Or does it reject an output create whose node or ancestors are edited in the same set?
       Preview and apply must not disagree.
     - (d) State that `nodeStepId` must name a persisted step. There is no `$ref` for steps.
   - Add a test for (b) or (c) to task 3.5.
   - Also correct "until the whole set commits" to "until the forward walk completes with no failure". Name the
     mechanism for skipping `OutputService.create`'s built-in `triggerBackfill` during the walk.

3. **D1: name the contract surface the new resource fields change, and decide where they live.**
   - `get_resource` returns the SHARED workspace-context types. `getPipelineResource` wraps `buildPipeline`'s
     `WorkspaceContextPipeline` (`WorkspaceSearchService.scala` l.218-226). The dashboard branch wraps
     `toDashboardEntry`'s `WorkspaceContextDashboard(id, name, panelCount)` (`WorkspaceContextProtocol.scala`
     l.148).
   - Those types back `GET /api/workspace/context` and its strict contract:
     - `schemas/workspace/workspace-context.schema.json` has `additionalProperties: false` on the pipeline entry
       (l.404-405) and the dashboard entry (l.427-442).
     - helio-mcp `types.ts`, `context.ts` and the `__golden__/workspaceContext.*.json` goldens.
     - The context-budget specs (`WorkspaceContextServiceApplyBudgetSpec`, helio-mcp `contextRequestBudget.test.ts`).
   - Required: decide one of two options and add tasks for it.
     - (i) Get-resource-only detail types, for example new `WorkspaceResourceDetail` payloads. The shared context
       stays unchanged.
     - (ii) Extend the shared types. In that case update `workspace-context.schema.json`, the helio-mcp
       types/goldens and the budget accounting, and say what per-pipeline `nodes` plus configs do to the
       full-context size.
   - Option (i) is the smaller change. The proposal's "Impact" and the tasks currently list only the patch-set
     schema as a contract change.

### Non-blocking notes

- D8 tag gating: ScalaTest `-l` beats `-n`, so "tag included AND env" needs a conditional exclusion, a `runMain`
  runner or a separate config. Pick one in the implementation, and keep the in-runner `HELIO_ASSISTANT_EVAL=1` check
  as the hard gate.
- `get_resource(pipeline)` is owner-only (`WorkspaceSearchService.scala` l.212-224). D2 allows editor/owner output
  creates. An editor can therefore propose against a pipeline whose node detail it cannot read. Acceptable for this
  ticket; worth a sentence in the PR.
- Task ordering: 0.4 is listed after 0.2 and before 0.3. That is cosmetic.
- design.md is 197 lines. It is dense, but the D-sections stay navigable, so length is not a clarity problem here.
