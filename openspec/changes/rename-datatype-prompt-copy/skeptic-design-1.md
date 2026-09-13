## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 7be9301d07f92b5c9eef0fbc824f94ac90f2a126 (planning artifacts uncommitted in change dir).

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> READY branch=task/rename-datatype-prompt-copy/HEL-1127.
- Re-checked every cited line in the four named files with `grep -n -i "data.\?type"`. The table is accurate for those four files: DashboardAuthoringPrompt L48-50/57/72, RefinementPrompt L108-109/117/118/120-121, AssistantSystemPrompt L7/9/72/74/85/87, WorkspaceAssistantTools L22/27/55. DashboardAuthoringPrompt L58/60 already say "Output". `c.dataType` is a column scalar type (correct KEEP).
- Wire boundary: `WorkspaceResourceType.fromString` (domain/model/WorkspaceResourceType.scala) accepts only `"dataType"`, and its scaladoc says that value now identifies a pipeline-output resource. Keeping the enum value is correct.
- Codebase-wide sweep of string literals: `grep -rn '"[^"]*\(DataType\|data type\)[^"]*"' backend/src/main`, plus a grep of helio-mcp/src. This found live LLM-facing copy outside the four files that the plan does not mention (see CR1-CR3).
- Test pins: grepped backend/src/test and helio-mcp/src for the missed phrases. The only hits are test names and comments, not verbatim assertions on the copy.

### Verdict: REFUTE

### Change Requests
1. **Scope too timid: a live tool schema is missed.** The ticket re-scope says "across the codebase (not limited to the 7 originally-cited lines)". But `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala` still sends "DataType" to Claude in tool descriptions: L55 ("must be an existing pipeline-output DataType id"), L448 ("bound to EXISTING pipeline-output DataTypes"), L451 ("for a DataType before proposing"), L458 ("output DataType name") and L459 ("no existing DataType that can answer"). These are the actual `propose_dashboard`/`propose_pipeline` tool schemas, the counterpart of the AssistantSystemPrompt L85/87 lines being renamed. If only the system prompt is renamed, the prompt and the tool schema will contradict each other. Add them to the Decisions table and tasks. The L80 comment is optional. L458's "output DataType name" also needs checking: the `outputDataTypeName` field was removed (HEL-907), so the text may be stale beyond wording.
2. **Missed LLM/user-visible messages in services.** `DashboardAuthoringService.scala:62` (EmptyWorkspaceMessage, "no pipeline-output data types yet"), `DashboardAuthoringService.scala:276` and `RefinementGrounding.scala:110` ("Could not load panel capabilities for data type $outputId") all refer to the Output entity. Classify each one: RENAME, or KEEP with a reason. The design must explicitly decide which kinds of copy are in scope.
3. **helio-mcp tool descriptions not classified.** `helio-mcp/src/tools/refinement.ts:50` ("pipeline-output DataTypes"), `tools/read.ts:87` ("bound DataType id") and `tools/read.ts:100` ("DataSource → Pipeline → DataType → Panel") are LLM-facing MCP tool copy about the retired entity. Rename them, or explicitly exclude helio-mcp with a recorded reason. `refinement.ts:108` lists the `dataType` wire value, so KEEP it.
4. **The renamed text must still tell the model which enum value an Output uses.** After the rename, the find/get_resource descriptions (WorkspaceAssistantTools L27/L55, AssistantSystemPrompt L72/L74) will say "Outputs", but the only accepted `type`/`resourceTypes` value is still `"dataType"`. Nothing will tell the model that an Output is `type: "dataType"`. That can break get_resource calls (it will guess `"output"`, which `fromString` rejects), and it is a behaviour change the HEL-1130 deferral does not cover. Require the renamed copy to keep that link, e.g. "Outputs (resource type \"dataType\")". Add a task that checks each renamed find/get_resource description mentions it.
5. **Verification is too narrow once scope grows.** Task 1.5 re-greps only four files. Replace it with the codebase-wide literal grep above, run over `backend/src/main` and `helio-mcp/src`, where every remaining hit is a documented KEEP. Add the helio-mcp test/typecheck gate if CR3 renames there. Add `sbt "testOnly *AssistantProposalToolSchemas*"` (or the matching spec) for CR1.

### Non-blocking notes
- Keeping the L50 quoted spec scenario title verbatim is correct.
- Leaving identifiers (`dataTypes`, `DataTypeDetail`, `WorkspaceResourceType.DataType`) as a Non-Goal is reasonable.
