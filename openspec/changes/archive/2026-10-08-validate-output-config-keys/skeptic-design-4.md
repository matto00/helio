## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed against worktree HEAD 55b7c4269d90eea7f3c71f3a2e3857a4018ee47b. The change dir is untracked because this is planning only.

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.
- `openspec validate validate-output-config-keys --type change` printed "Change 'validate-output-config-keys' is valid".

### What I verified (with evidence)

**Round-3 CR1 adoption (D11, tasks 1.7/4.7, Risks bullet): mostly present.**
- D11 is in design.md. Tasks 1.7 and 4.7 exist. The Risks bullet "Assistant pipeline proposals / refinement Output edits..." exists.
- `AssistantProposalToolSchemasSpec.scala` and `RefinementEditShapeSpec.scala` exist under `backend/src/test`, so task 4.7 is executable.
- The D5 wording nit was adopted: "`null` is OK on chart/metric; on any other kind `aggregation` is not a known key at all, so even `null` is rejected by the key check".
- One part of CR1(a) is missing: round 3 asked for a **spec requirement** for the assistant surfaces. The only agent-docs requirement is in `specs/mcp-output-tools/spec.md`, and it names helio-mcp tools only. D11 has no spec anchor.

**Sweep for other agent-facing writers of Output config (the orchestrator's question).**

I enumerated every backend Output config write site:
- `OutputService.create` / `OutputService.update` (OutputService.scala L133/L244)
- `PipelineService` single-call create (L642) and proposal grounding (L1506)
- `PatchSetPreviewProjection` L136
- `PatchSetApplyForward` L87 (pipeline create) and L105 (output update)
- `PatchSetApplyRollback` L181
- `PatchSetUndoService` L297

Each of these is covered by tasks 1.2–1.5. I then traced every agent-facing producer that feeds those sites:

| Surface | Writes Output config? | Covered? |
|---|---|---|
| helio-mcp `add_outputs_from_shape` (`pipelinesHandlers.ts` ~L257) | No. `createOutput({nodeStepId, kind, name})` sends no config. | n/a, safe |
| Backend shape expand `ExpandPipelineShapeResponse.outputs` (`PipelineShapeProtocol.scala` L88/L92) | Always `None` ("dormant"). The frontend `handleInstantiateShape` loop never receives config. | n/a, safe |
| FirstRun / PersonaTemplates (`FirstRunPlanner.scala` L71, L130) | Yes: table `columnOrder`, chart `chartType` + `fieldMapping{xAxis,yAxis}`. Template chartTypes are only `bar` (5) and `line` (3). | Passes the planned key sets and enum |
| Dashboard proposal `aggregation` (`DashboardProposalProtocol.scala` L31) | No. This is a panel field, not Output config. | n/a |
| Output controls tools (`outputControlsHandlers.ts` L66) | No. They write panel `config.controls`. | n/a |
| Frontend `TableRenderer` L252-274 (`columnSort`, `columnFilters`, `pinnedColumns`) and editor `read*Config` keys (`outputConfigTypes.ts` L179-293) | Yes | All in the spec key sets |
| In-app assistant `propose_pipeline` / `propose_combined` (`AssistantProposalToolSchemas` L242-267, reused at L306/L352) | Yes | D11 / task 1.7 |
| `/api/refinements` prompt (`RefinementPrompt.scala` L27 → `RefinementEditShape.Description`) | Yes | D11 / task 1.7 |
| **In-app workspace assistant's own `propose_patch_set` tool** (`AssistantProposalToolSchemas.scala` L361-392 `EditTargetSchema` / `EditSchema`; guidance `AssistantSystemPrompt.scala` L53-62) | **Yes.** `target.kind` enum includes `"output"` (L364). The patch description (L384-391) says only "matching target.kind's existing update-request shape". `AssistantToolExecutor.executeProposePatchSet` (L317-333) sends it through `patchSetPreviewService.preview`, which task 1.3 now validates. | **NOT covered.** |
| **helio-mcp `apply_patch_set`** (`refinement.ts` L78-104; `refinementSchemas.ts` `editTargetSchema` includes `"output"`, `patch` is an untyped record) | **Yes**, for hand-authored Output update edits. These are validated on apply (tasks 1.3/1.5). | **NOT covered.** Neither task 2.3 nor the mcp-output-tools requirement lists it. |

**Why the workspace assistant's `propose_patch_set` is a distinct surface from `RefinementEditShape`.**
- `RefinementEditShape` is referenced only by `RefinementPrompt.scala` L27, which is the `/api/refinements` service.
- `grep -rn "RefinementEditShape\|RefinementPrompt"` outside `services/patchsets/Refinement*` returns nothing.
- So the workspace assistant never sees D11's refinement text. It authors Output patches from `EditSchema` plus the system prompt only.
- D11 states that the assistant writes Output config "through two surfaces". There are three. The third is the one the assistant reaches directly in chat.

**Nothing else broke.** I re-checked the round-1..3 resolutions (D3 tolerance, D9 rollback policy, D10 null clear, D5 metric gating) against the current artifacts. I found no new contradictions between proposal, design, tasks and the spec deltas.

### Verdict: REFUTE

This REFUTE comes from the same reasoning as round 3's CR1, applied consistently: a path this change tightens has an agent-facing contract with no planned doc update. Mitigation: the D4 error message ends with the kind's known-key list, so an agent can self-correct after one failure. That makes this a narrow, cheap fix, not a design flaw.

### Change Requests

1. **Add the workspace assistant's `propose_patch_set` to D11 and task 1.7/4.7.**
   - Put `OutputConfigValidation.KeysDoc`, or a pointer sentence plus the doc, into the description of `AssistantProposalToolSchemas.EditSchema`'s `patch`, scoped to `target.kind: "output"` (L384-391). Alternatively, put it in the `propose_patch_set` guidance in `AssistantSystemPrompt.scala` L53-62.
   - Correct D11's "two surfaces" to three, and state that `RefinementEditShape` is the `/api/refinements` prompt, not the workspace assistant's.
   - Extend task 4.7 so `AssistantProposalToolSchemasSpec` also asserts the keys appear on the patch-set surface.
2. **Add helio-mcp `apply_patch_set` (and `propose_patch_set`'s pass-through text if touched) to task 2.3 and to the `mcp-output-tools` requirement's tool list.**
   - An `output`-kind update edit's `patch.config` must document the same per-kind keys and aggregation shapes, plus the 400 / `failure` behaviour.
   - Extend the scenario or add one so the `apply_patch_set` description is checked.
3. **Give D11 a spec anchor (the unaddressed half of round-3 CR1(a)).**
   - Add an ADDED requirement, either in `mcp-output-tools` (renamed in scope to "agent-facing Output config docs") or in a delta for the assistant capability.
   - It should state that the in-app assistant's `propose_pipeline` / `propose_combined` Output `config`, its `propose_patch_set` output-edit `patch`, and the `/api/refinements` Output-edit text document the per-kind keys and both aggregation shapes, sourced from the validator's key table.

### Non-blocking notes
- FirstRun / PersonaTemplates internal configs pass the planned rules today. A FirstRun test is already the natural regression catch if a future template adds a key, so no extra task is needed. You could optionally cite it in task 1.4's verification.
- The `ExpandPipelineShapeResponse.outputs` path is dormant (always `None`). If it is ever enabled, its config will hit the validator via `createOutput`, which is correct, so there is nothing to do now.
