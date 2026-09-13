# HEL-1127: Decide whether to rename "DataType" in LLM prompt and tool copy

## Description

HEL-1118 left 7 lines across 4 sites deliberately unedited: `DashboardAuthoringPrompt.scala:49,72`, `RefinementPrompt.scala:108-109`, `AssistantSystemPrompt.scala:7,9`, `WorkspaceAssistantTools.scala:55`.

They use "DataType" as prompt- and tool-facing product terminology, even though DataTypes were retired in favour of Outputs. Renaming them to "Output" would align the copy with the product, but it can shift LLM behaviour.

## Acceptance Criteria

* Decide rename vs keep for each site, with the reason recorded on this ticket.
* If renaming, validate that the assistant, authoring and refinement flows still behave correctly by running representative prompts before and after and comparing tool-call shape.
* If keeping, add a comment at each site saying the term is intentional.

## Re-scope (owner ruling, 2026-09-12)

The owner has decided: **rename** "DataType" to "Output" in qualifying LLM prompt/tool copy sites. The owner's ruling names "these LLM prompt/tool copy sites" (the 4 files originally cited); this ticket interprets that as the backend assistant/authoring/refinement prompt-and-tool-copy surface as a whole (not limited to the 7 originally-cited lines within those 4 files, since HEL-1118 already partially addressed one of them — see design.md's "Design-gate round 1 REFUTE" table for the full, re-enumerated backend site list, bounded to `services/assistant`, `services/proposals`, `services/patchsets`, `services/workspace`, and `api/protocols/assistant`). It explicitly does **not** extend to `helio-mcp` — a separate package/delivery surface with its own tests, not named by the ticket or the owner's ruling — tracked instead as follow-up HEL-1132. The owner chose speed over in-ticket validation: the before/after LLM prompt-behavior comparison called for in AC2 is explicitly deferred to the already-filed sibling ticket **HEL-1130** ("Validate LLM behaviour after the DataType→Output prompt-copy rename"), not performed here. This is a conscious re-scope of the original "decide + validate" AC, recorded here and in the closing PR/ticket comment.

Scope boundaries (do not cross):
* Rename only LLM-facing prompt copy and tool-schema description copy that refers to the retired DataType *entity* (now Output).
* Do NOT rename occurrences that refer to a column's scalar data type (string/number/etc.) — a different, still-current concept.
* Do NOT rename the `WorkspaceAssistantTools.ResourceTypeEnum` wire value `"dataType"` (JSON Schema enum consumed by `WorkspaceResourceType.fromString`) — that is a wire contract, not copy. If any other site's rename would require a wire/contract change, escalate rather than proceeding.
* Tool copy asserted verbatim by tests/snapshot fixtures must be updated deliberately to reflect the intended copy change — not blindly regenerated.
