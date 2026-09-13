## Why

HEL-1118 (pipelines-and-outputs remodel) left "DataType" as stale terminology in several
LLM-prompt and tool-schema copy sites, even though the DataType entity was retired in favour
of Output. The owner has ruled: rename these sites to align copy with the current product
vocabulary. In-ticket before/after LLM-behavior validation is deliberately deferred to the
already-filed sibling HEL-1130, trading validation now for delivery speed.

## What Changes

- Rename "DataType"/"DataTypes" to "Output"/"Outputs" in LLM-facing prompt copy and tool-schema
  description copy across `DashboardAuthoringPrompt.scala`, `RefinementPrompt.scala`,
  `AssistantSystemPrompt.scala`, `WorkspaceAssistantTools.scala`, and (found during design-gate
  review) `AssistantProposalToolSchemas.scala`, plus the `degradeMessage`/`EmptyWorkspaceMessage`
  warning strings in `DashboardAuthoringService.scala`/`RefinementGrounding.scala` — doc comments,
  prompt string literals, and tool-schema `description` fields.
- Where a tool description's prose now says "Output(s)" but the underlying wire value Claude must
  send is still `"dataType"` (`WorkspaceResourceType.fromString`, unchanged), add an explicit
  disambiguating hint so the model doesn't emit an invalid `"output"` value.
- Leave untouched: any occurrence referring to a column's scalar data type (string/number/etc.,
  e.g. `c.dataType`), and the `WorkspaceAssistantTools.ResourceTypeEnum` wire value `"dataType"`
  consumed by `WorkspaceResourceType.fromString` — a wire contract, not copy.
- `helio-mcp`'s own "DataType" tool copy (`read.ts`, `refinement.ts`) is explicitly OUT of scope
  for this ticket: this ticket's scope is the backend prompt/tool-copy surface for the
  assistant/authoring/refinement flows (`services/assistant`, `services/proposals`,
  `services/patchsets`, `services/workspace`, `api/protocols/assistant`); `helio-mcp` is a
  separate package/delivery surface outside that boundary — filed as standalone follow-up
  HEL-1132.
- Update any test/snapshot fixture that asserts the old copy verbatim, to reflect only the
  intended copy change.
- No before/after LLM-behavior comparison performed here (deferred to HEL-1130).

## Capabilities

### New Capabilities
(none — pure copy change, no new behavior)

### Modified Capabilities
(none — no spec-level requirement changes; prompt/tool copy wording is not a documented
contract behavior. `skip_specs: true` set in `.openspec.yaml`.)

## Non-goals

- Running representative before/after LLM prompts to compare tool-call shape (HEL-1130).
- Any change to tool names, JSON field names, or wire-level contracts.
- Any rename of genuine column-data-type references.

## Impact

- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringPrompt.scala`
- `backend/src/main/scala/com/helio/services/patchsets/RefinementPrompt.scala`
- `backend/src/main/scala/com/helio/services/assistant/AssistantSystemPrompt.scala`
- `backend/src/main/scala/com/helio/services/workspace/WorkspaceAssistantTools.scala`
- `backend/src/main/scala/com/helio/api/protocols/assistant/AssistantProposalToolSchemas.scala`
- `backend/src/main/scala/com/helio/services/proposals/DashboardAuthoringService.scala`
- `backend/src/main/scala/com/helio/services/patchsets/RefinementGrounding.scala`
- Associated Scala specs/tests asserting the old copy verbatim.
- NOT `helio-mcp/**` — see Non-goals; tracked as HEL-1132.
