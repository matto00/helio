## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 7be9301d07f92b5c9eef0fbc824f94ac90f2a126 (planning artifacts uncommitted in worktree).

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/rename-datatype-prompt-copy/HEL-1127`.
- Read ticket.md, proposal.md, design.md, tasks.md, and skeptic-design-1.md.
- Checked the round-1 sites in the live code (`grep -rnE '"[^"]*[Dd]ata ?[Tt]ypes?[^"]*"' backend/src/main`):
  - AssistantProposalToolSchemas.scala L55/448/451/458-459 are string literals, and L80 is a comment. RENAME is correct.
  - DashboardAuthoringService.scala L62/L276 and RefinementGrounding.scala L110 are warning copy. RENAME is correct.
  - DashboardAuthoringPrompt L57, RefinementPrompt L117/118/120-121, AssistantSystemPrompt L72/74/85/87, and WorkspaceAssistantTools L27/L55 match the design tables.
- Wire-value risk: `WorkspaceResourceType.fromString` accepts only `"dataType"` (WorkspaceResourceType.scala:35). `ResourceTypeEnum` is at WorkspaceAssistantTools.scala:22. Adding a disambiguation hint is a sound mitigation. The hint text does not trip AssistantSystemPromptSpec L103-113. That test bans `"metric"`, `"chart"` and similar strings, but not `"dataType"`. The L123 negative assertion is also unaffected.
- The spec files cited in tasks exist: WorkspaceAssistantToolsSpec, AssistantProposalToolSchemasSpec, DashboardAuthoringServiceSpec. No test pins `EmptyWorkspaceMessage` or the "Could not load panel" text (grep found nothing).
- Owner ruling in ticket.md "Re-scope": rename "in qualifying LLM prompt/tool copy sites **across the codebase** (not limited to the 7 originally-cited lines)".
- HEL-1132 exists in Backlog (Linear). Its description repeats the same claim that helio-mcp "wasn't named by the ... owner ruling".
- Whole-backend hit count: `grep -rnE '[Dd]ata ?[Tt]ype' backend/src/main | wc -l` = 383.

### Verdict: REFUTE

(a) The classification of the round-1 sites is correct. (c) The disambiguation approach is sound in principle. (b) and (d) do not hold, as detailed below.

### Change Requests
1. **The helio-mcp exclusion rests on a misstated ruling.** design.md (helio-mcp row: "not ... covered by the owner's ruling as delivered to this run"), proposal.md (Non-goals/What Changes), and HEL-1132's description all say the owner ruling doesn't cover helio-mcp. ticket.md says the opposite: "across the codebase (not limited to the 7 originally-cited lines)". helio-mcp/src/tools/read.ts:5/87/100/305 and refinement.ts:50 are LLM-facing tool copy for external agent clients, so they fit that ruling. Narrowing an explicit owner ruling is not the planner's call. Choose one:
   - (i) Bring those 5 sites into this ticket, with a helio-mcp test task (`helio-mcp` test suite). Keep refinement.ts:108's `dataType` wire value untouched.
   - (ii) Get the owner to explicitly approve the exclusion (escalation) and cite that approval in design.md.

   Either way, remove the false "not covered by the owner's ruling" rationale from design.md, proposal.md and HEL-1132.
2. **Task 1.7 cannot pass as written.** It asks that "every remaining hit is one of design.md's documented KEEP sites" across all of backend/src/main. There are 383 hits, and most are historical HEL-904 doc comments that no KEEP table lists (e.g. ApiRoutes.scala:283-284, model.scala:838, PatchSetProtocol.scala:52-113). An executor must either fail the task or quietly reinterpret it. Rescope it to LLM-visible copy: string literals, plus doc comments in the 7 touched files. Give the exact grep command. List every remaining literal KEEP with its reason:
   - WorkspaceResourceType.scala:24/35 (wire value)
   - WorkspaceResourceSearchProtocol.scala:53/63 (wire discriminator)
   - RefinementEditShape.scala:270 (`"dataType"` named as an invalid target.kind: correct as-is, it is the wire value)
   - WorkspaceContextBudget.scala:91 (`"dataTypes"` JSON key: classify it as a wire key, or rename it after verifying consumers)
   - WorkspaceContextComputations.scala:424 (column scalar type)
   - DashboardAuthoringPrompt/RefinementPrompt L56/L116 (`c.dataType`)
   - the DashboardAuthoringPrompt L50 quote
3. **tasks.md contradicts design.md on the L55 hint.** design.md's revised WorkspaceAssistantTools row says to add the `(resource type "dataType")` hint "alongside the L27-28/L55 renames". Task 1.4 renames L55 to "an Output's columns/..." with no hint. Align them, and quote the exact replacement text for each hinted site so the executor doesn't make it up.
4. **Nothing tests the disambiguation hint.** design.md calls the wire-value confusion "a functional risk, not merely cosmetic, so it is fixed here". Yet no task adds an assertion that would fail if the hint were left out or dropped later. The "Verify" steps only re-run existing specs, which pass with or without the hint. Add assertions:
   - WorkspaceAssistantToolsSpec: the find and get_resource `description`s mention `"dataType"`.
   - AssistantSystemPromptSpec: `text` includes the L72/L74 hint.
   - Optionally, a negative assertion that no description contains the bare string "DataType".

### Non-blocking notes
- "no pipeline-output Outputs yet" (task 1.6, DashboardAuthoringService L62) says "output" twice. "no pipeline Outputs yet" matches RefinementPrompt's new "Available pipeline Outputs:" header.
- design.md's Risks section still says "re-greps all four files", which is stale next to task 1.7. Update it together with CR2.
- RefinementGrounding.scala L110 has no spec coverage. That's fine for a string change, but say so explicitly.
