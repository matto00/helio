## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 8fff8eed1ca2b7ee8df6f70aade2a0fa9e76d3a7 (planning artifacts untracked in the change dir).
Paths below are relative to `backend/src/main/scala/com/helio/` unless noted.

### What I verified (with evidence)

Context facts, checked against the tree:

- **CONFIRMED: `get_resource(pipeline)` laneTree is always `[]`.** `WorkspaceSearchService.getPipelineResource`
  (l.218-226) calls `workspaceContextService.buildPipeline(summary, user)` with no map arguments. The defaults are
  `Map.empty` (`WorkspaceContextService.scala` l.272-290). `laneTreeFromRoots` therefore receives empty steps and roots.
  `toStepEntry` (l.335) emits only `{position, type, outputColumns(names), validationError}`.
- **CONFIRMED: `find` matches the whole query as one substring.** `WorkspaceSearchService.matchesQuery` (l.102):
  `name.toLowerCase.contains(normalizedQuery) || description...`.
- **CONFIRMED: output create is rejected in patch sets.** `PatchSetApplyResolvers.scala` l.~90:
  `case ("output", "create") => ... "edit $index: create is not supported for output"`.
- **CONFIRMED: `lookup {}` passes propose.** `requiredConfigProblems` is reached only through
  `StepConfigValidation.validate` (analyze) and `InProcessPipelineEngine` (run). `PipelineProposalService.validate`
  (l.89-) has no call to either. `LookupStep.requiredConfigProblems` exists (l.150).
- **CONFIRMED:** an Output id as a root gives `roots[i]: data source not found` (`PipelineProposalService` l.112).
- **CONFIRMED:** `MaxHops = 4` (`AssistantService.scala` l.56). `ClaudeClient.sendWithTools` runs all of one
  response's tool_uses through `Future.traverse(toolUses)(executeTool(...))`. `executeTool` wraps each call in
  `Future(executor.execute(...))` (`ClaudeClient.scala` l.125-150).
- **FALSE: the D2 claim "Validation reuses `OutputService` create validation. That includes the
  fieldMapping-columns-at-node check".** `OutputService.create` (`services/pipelines/OutputService.scala` l.124-170)
  calls `OutputService.validateConfig(kind, config, JsObject.empty)`. That reaches
  `OutputConfigValidation.validateConfig` (l.202-223), which checks keys, slot names, compare, payload and formats. It
  never resolves the node schema and never calls `OutputBindingSpec.validateFieldMappingColumnsExist`. The
  column-at-node check is reached only through `PipelineServiceSupport.validateOutputFieldMapping`. Its only callers
  are `PipelineCreateTransaction` (l.246) and `PipelineProposalAnalyze` (l.149), which are the pipeline-create and
  proposal-analyze paths. That is where the owner's apply error came from.
- **NOT IN THE DESIGN: a discovery gap.** `get_resource(dashboard)` returns only `WorkspaceContextDashboard(id, name,
  panelCount)` (`WorkspaceContextProtocol.scala` l.148, `toDashboardEntry` l.458). It has no panels and no bound
  outputIds. `get_resource(<Output>)` returns `WorkspaceContextOutput`, which has no `pipelineId` or `nodeStepId`
  (l.99-110). In the transcript, the agent reached pipeline `d745…` only because `find("standings", [dataType,
  pipeline])` matched by name (transcript step 5). Nothing structural links dashboard → panel → Output → pipeline.
- **NOT IN THE DESIGN: D2 reverses an earlier deliberate rule.** `RefinementPrompt.scala` l.33-39 (HEL-670) says a
  create's id does not exist until apply and must never be referenced by another edit in the same set.
  `RefinementEditShape.CreateExample` (l.258-266) says "output has NO create op of its own". The assistant's own
  `AssistantProposalToolSchemas.EditSchema` says `target.kind "output" (update only)`, and its `EditTargetSchema.parentId`
  says "currently only pipelineStep". D2 overturns all four texts, and the design names none of them.
- **Precedent for intra-proposal references.** `propose_combined` already uses the sentinel `"$pipelineOutput"`
  (`AssistantProposalToolSchemas` l.537-545), and pipeline proposals use `clientId`/`nodeStepClientId`. So D2's
  `"$ref:<ref>"` follows existing practice; it is not a new idiom.
- Compute grammar (`docs/compute-expression-grammar.md` l.22-49): `$col`, with dotted names as one flattened column
  (`$stats.pts_ppr`). The D3 example `round($settings.fpts + $settings.fpts_decimal / 100, 2)` is plausible. `concat(…)`
  is not documented (`+` concatenates). D3 already says to verify the examples, which is enough.
- Root `{sourceId, type}`: `validateSourceSelector` already returns "specify either sourceId or an inline type, not
  both" (`PipelineProposalService` l.181-192). The 4× repeat in the transcript came from parallel fan-out (D5), not an
  unclear error.
- `testFull` has no tag-exclusion mechanism today (`backend/build.sbt`). D8 has to add one.
- The patch-set JSON schema enumerates `output` among the kinds (`schemas/patch-sets/patch-set.schema.json` l.99). The
  frontend `features/patchSets/types/patchSet.ts` exists.

Judgment on the orchestrator's three questions:

1. **D2.** It is legitimately self-approvable: the ticket says "scope it or file a follow-up". It is also the right,
   minimal shape for the ticket's primary correct plan, which is to add Outputs at an existing node and bind panels on
   an existing dashboard. Two-proposal and `propose_combined` are correctly rejected. The ticket's alternative plan
   (one new pipeline with N Outputs bound on an existing dashboard) remains inexpressible. That is acceptable but
   should be stated. As written, though, D2 rests on a false validation claim (CR1) and omits the HEL-670 reversal
   (CR4).
2. **D8 honesty.**
   - The before/after structure is sound, and the $3 cap is plausible: Haiku 4.5, about 5 cases × 2 runs × ~4-5 hops
     of ~15-25k input tokens.
   - "Applies cleanly" is meaningful only if output-create apply actually checks columns at the node. Without CR1, a
     bad Output applies "cleanly" and renders broken.
   - "Failed call" is not defined, and there is no rule for when `MaxHops` binds (CR5).
   - The 4-hop path is feasible only if hop 1's `find` surfaces the dashboard, the Output and the pipeline together.
     That depends on name luck unless CR3 lands.
3. **Taxonomy coverage.**
   - 1 → D3 panel-field rejection + D7.
   - 2 → D3 (parentId) + D5 (root fan-out). The existing root error is already clear; say so in the taxonomy file.
   - 3 → D3 + D4.
   - 4 → D1, plus the discovery gap in CR3.
   - 5 → D4.
   - 6 → D2 + D7. The ticket also asks that the tool *descriptions* say which tool edits an existing dashboard; D7
     covers only the prompt (see the notes).
   - 7 → D5 + D7.
   - 9 → D6.
   - No item is left uncovered, but item 4's "make sure that's discoverable" is only half met (CR3), and D5 as
     specified is not implementable correctly (CR2).

### Verdict: REFUTE

### Change Requests

1. **D2 / spec `patch-set-apply` "Mapped column missing at the node": fix the false reuse claim.**
   - The problem: `OutputService.create` does not check fieldMapping columns at the node (evidence above).
   - Required: the design must state that an `output` create, at both preview and apply, resolves the target node's
     schema the way `PipelineCreateTransaction` does (`analyzeNodes` via `resolveSecondarySourceSchemas`). It then runs
     `PipelineServiceSupport.validateOutputFieldMapping(kind, config, nodeSchema)`, extracted or shared as needed.
     State the same for `nodeStepId` existence and pipeline membership.
   - Add to D0 a probe: does `analyzeNodes` actually project a *configured* lookup's added column (e.g.
     `display_name`) at the lookup node? D1's spec scenario and the whole Standings plan depend on it, and
     `resolveSecondarySourceSchemas`'s doc says lookup is resolved "for schema warnings".
   - Decide whether `OutputService.create` (the REST route) gains the same check, or state that it deliberately does not.

2. **D5: specify where and how "one propose per response" is enforced.**
   - The problem: `ClaudeToolExecutor.execute(name, input)` has no notion of a response or hop. `ClaudeClient` runs
     each tool_use in `Future(...)` concurrently, so execution order inside the executor is not deterministic. The
     obvious "counter in `AssistantToolExecutor`" reading is wrong two ways: it is racy, and if it counts per turn it
     blocks the legitimate corrected re-propose in the next hop.
   - Required: name the mechanism. For example, a per-response hook or partition in `sendWithTools` (it is the only
     caller per `AssistantService`'s doc), or a batch-aware executor method. Define "first" as response block order.
   - Add a test scenario: a failed propose in hop N followed by a corrected propose in hop N+1 *is* executed.

3. **D1 / D7: close the dashboard → Output → pipeline discovery gap, or justify leaving it.**
   - Add to `get_resource(dashboard)` the panels `{id, title, type, outputId}`, plus each bound Output's `pipelineId`.
     Add to `get_resource(<Output>)` its `pipelineId` and `nodeStepId`. Add a `workspace-resource-search` spec
     scenario for it.
   - Alternatively, state why name-matching `find` is sufficient. The ticket's own scope says "make sure that's
     discoverable", and the eval case "add a line chart to an existing dashboard" depends on it.
   - In D8, pin the fixture pipeline's name to a recorded value: the prod name if known, otherwise a name that does
     *not* contain "Standings". The eval must not pass on name-match luck.

4. **D2: acknowledge and reconcile the HEL-670 / HEL-914 reversal.**
   - List each text that changes:
     - `AssistantProposalToolSchemas.EditSchema` patch description ("output (update only)");
     - `EditTargetSchema.parentId` description ("currently only pipelineStep");
     - `RefinementEditShape.CreateExample` and the HEL-670 rule in `RefinementPrompt`, with an explicit decision: does
       refinement gain output create plus `$ref`, or stay unsupported with corrected wording?
     - any test pinning "create is not supported for output".
   - Add these to the tasks (1.8 / 1.11 or a new task).

5. **D8 / eval spec: make the AC measurement unambiguous.**
   - Define "failed tool call": an `isError` tool_result, including decode failures. State whether a zero-result
     `find` counts.
   - Define a Standings pass: exactly one captured proposal, preview ok, real apply ok, no hop-budget exhaustion,
     ≤ 2 failed calls.
   - State that if `MaxHops = 4` is what fails the after-run, the AC is **unmet** and the lane raises ESCALATION to
     the owner (HEL-1637 territory). It must not be shipped as a "recorded" miss.
   - Give the per-case cost estimate that shows baseline plus after for all 5 cases fits under $3.

### Non-blocking notes

- D4: prefer running the whole `StepConfigValidation.validate` (declared required keys plus the per-kind validators for
  aggregate, window, join and so on) at propose time, not only `requiredConfigProblems`. Otherwise an aggregate with
  no measures still passes propose.
- D4: the existing invalid-type error lists `PipelineStepKind.All`, which includes non-authorable `join`/`groupby`.
  List only authorable kinds, consistent with the D3 enum.
- D3 parity test: `requiredConfigProblems` returns messages, not a key list, so "required keys equal" cannot be read
  by introspection. Specify the mechanism: remove each schema-required key from a valid example and assert a non-empty
  result; assert the full example yields an empty one.
- Item 6: also update the `propose_dashboard` tool description to say it always creates a new dashboard, and the
  `propose_patch_set` description to say it is the tool for adding to an existing dashboard. The ticket asks for both
  prompt and tool descriptions.
- D8: besides the sbt tag, gate the runner on an explicit opt-in env var. Then a regression in tag config cannot make
  CI call Anthropic.
- D2: `OutputService.create` calls `triggerBackfill` after insert. Check how this behaves inside patch-set apply and
  rollback, where a rolled-back Output must not have an orphan backfill.
- HEL-1652 overlap on `PipelineProposalService` is already flagged; keep it.
