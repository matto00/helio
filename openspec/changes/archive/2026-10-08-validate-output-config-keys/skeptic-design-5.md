## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed against worktree HEAD 55b7c4269d90eea7f3c71f3a2e3857a4018ee47b. The change dir is untracked because this is planning only.

- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/output-config-key-validation/hel-1313`.
- `openspec validate validate-output-config-keys --type change` printed "Change 'validate-output-config-keys' is valid".

### What I verified (with evidence)

**Round-4 CR1: the workspace assistant's `propose_patch_set` is now covered.**
- D11 now names three surfaces: (a) the pipeline proposal, (b) `propose_patch_set`, and (c) `/api/refinements`. It also states that `RefinementEditShape` is used by `RefinementPrompt`.
- The code matches the citations:
  - `AssistantProposalToolSchemas.scala` L242-267: `PipelineProposalOutputSchema` has `config` as a bare `{"type":"object"}`.
  - L364: `EditTargetSchema` includes `"output"`.
  - L381-391: the `EditSchema.patch` description is generic.
  - `AssistantToolExecutor.executeProposePatchSet` routes through `patchSetPreviewService.preview`.
  - `RefinementEditShape.scala` L211-216 and L260-261 hold the Output-edit text.
- Task 1.7 now targets all three surfaces. Task 4.7 asserts the proposal schema, the `propose_patch_set` patch description and `RefinementEditShapeSpec`.

**Round-4 CR2: helio-mcp `apply_patch_set` is now covered.**
- The `mcp-output-tools` requirement lists `apply_patch_set` (output update edits) and adds the scenario "apply_patch_set documents Output-edit keys".
- Task 2.3 names `apply_patch_set` in `refinement.ts`. Its description is at L78-104 and today has no Output-config key guidance.
- Task 4.7 adds a helio-mcp test. `refinementSchemas.test.ts` and `server.test.ts` already exist and reference `apply_patch_set`, so the test can be written.

**Round-4 CR3: D11 now has a spec anchor.**
- There is a new delta at `specs/assistant-conversation-loop/spec.md`. The base capability exists at `openspec/specs/assistant-conversation-loop/spec.md`, and the delta is ADDED.
- The requirement names all three surfaces. It has a "same key table, cannot drift" scenario that the single-source `KeysDoc` design makes testable.
- The proposal's Capabilities section lists all three modified capabilities.

**Regression sweep: nothing else broke.**
- D3 tolerance, D5 metric gating, D9 rollback policy, D10 null clear and the D6 shallow merge are all unchanged.
- Tasks 1.1-1.6 and 4.1-4.6 are unchanged and still consistent with the output-routes-api delta.
- I found no new contradictions between the proposal, design, tasks and the three deltas.

### Verdict: CONFIRM

All three round-4 change requests are adopted and match the code. The items below are wording or completeness nits that the executor and evaluator can carry. None blocks implementation.

### Non-blocking notes
- **Metric aggregation shape in the MCP requirement.** The `mcp-output-tools` requirement names only the metric `{ value, agg }` shape, but the validator (D5) and the assistant delta also accept `{ agg }` with `fieldMapping.value`. When writing the task 2.3 helio-mcp docs, document both metric shapes, matching the output-routes-api requirement. The evaluator should check this.
- **Stale "both prompts" wording.** design.md Risks bullet 4 still says "D11 documents the keys in both prompts", but D11 now names three surfaces. This is a cosmetic leftover.
- **Decision ordering.** Decisions appear in the order D9, D11, D10, D8. This is cosmetic only.
- **Optional extra placement.** For `propose_patch_set`, `KeysDoc` could also go in the `AssistantSystemPrompt` guidance, but task 1.7's placement in the patch description is enough. Task 4.7's test should assert the text appears on the `output` patch surface, not just somewhere in the schema blob.
- These are carried from round 4 and still hold: the FirstRun/PersonaTemplates configs already pass the planned rules, and the `ExpandPipelineShapeResponse.outputs` path is inactive (always `None`).
