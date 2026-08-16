## Why

The preference store (420-A, `AgentPreferences`) and agent-memory store (420-B, `AgentMemoryEntry`)
are inert until the agent actually reads them when authoring. This change wires both into the
grounding context so in-app NL authoring (HEL-341) and conversational refinement (HEL-343) start
warm instead of cold, and so external MCP-based agents can read the same data via
`get_workspace_context`.

## What Changes

- **Backend**: extend `WorkspaceContextService.assemble` (and its `WorkspaceContextResponse` wire
  shape) with a new, always-present `agentContext` section: the caller's `AgentPreferences` plus
  their top-N most-recently-useful `AgentMemoryEntry` records (by `lastUsedAt`, falling back to
  `createdAt` for never-used entries). Every entry surfaced this way is `touch`ed (its
  `lastUsedAt` bumped to now) in the same assembly call, so 420-B's LRU eviction order reflects
  real usage. `WorkspaceContextService` gains two new, `Option`-guarded dependencies
  (`Option[AgentPreferencesService]`/`Option[AgentMemoryService]`) — mirroring
  `WorkspaceRoutes`'s existing `workspaceTeardownServiceOpt` nullability precedent — so an
  environment without those services still assembles a context, with an empty `agentContext`.
  Every existing consumer of `WorkspaceContextService.assemble` (`DashboardAuthoringService`
  HEL-341, `RefinementGrounding` HEL-343, `GET /api/workspace/context`) picks this up for free —
  additive field, no signature change to `assemble` itself.
- **Backend prompt**: `DashboardAuthoringPrompt.userMessage` gains a short, compact rendering of
  `agentContext` (preferences summary + memory bullet list) appended to the grounding section sent
  to Claude, so the NL authoring flow's actual model prompt — not just the wire response — reflects
  the caller's preferences/memory.
- **MCP**: extend `helio-mcp/src/context.ts`'s `WorkspaceContext` with an always-present
  `agentContext` block (`preferences` + top-N `memory`, same N as the backend), fetched via two new
  `HelioApi` methods (`getAgentPreferences` → `GET /api/preferences`, `listAgentMemory` → `GET
  /api/agent/memory`) added to the existing client-side fan-out in `buildWorkspaceContext`. This
  path does NOT call `touch` — MCP reads are a lighter-weight surface than the NL-authoring flow
  the eviction cap exists to protect (see design.md Planner Notes). `get_workspace_context`'s tool
  description and the `helio://workspace/context` resource description are updated to mention the
  new block.
- **Types**: `helio-mcp/src/types.ts` gains `AgentPreferencesResponse`/`AgentMemoryEntryResponse`
  interfaces mirroring the backend wire DTOs.
- No FQNs inlined in Scala.

## Capabilities

### New Capabilities

- `workspace-context-agent-section`: the backend `WorkspaceContextResponse.agentContext` field,
  its assembly (including the touch-on-surface side effect), and its rendering into the NL
  authoring prompt.
- `mcp-context-agent-block`: the MCP `WorkspaceContext.agentContext` field and its fetch.

### Modified Capabilities

(none — additive fields on existing response shapes; no existing requirement's behavior changes)

## Impact

- Affected code: `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala`,
  `backend/src/main/scala/com/helio/services/AgentMemoryService.scala` (new `touch` method),
  `backend/src/main/scala/com/helio/services/DashboardAuthoringPrompt.scala`,
  `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala`,
  `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala`,
  `backend/src/main/scala/com/helio/api/ApiRoutes.scala` (wiring),
  `schemas/workspace-context.schema.json`; `helio-mcp/src/context.ts`, `helio-mcp/src/helioApi.ts`,
  `helio-mcp/src/types.ts`, `helio-mcp/src/tools/read.ts`, `helio-mcp/src/index.ts` (resource
  description only).
- No frontend (`frontend/**`) changes — this ticket is backend + MCP grounding only.
- No changes to `AgentPreferencesService`/`AgentMemoryRepository`'s existing public surface beyond
  adding one new `AgentMemoryService.touch` wrapper method (the repository's own `touch` already
  exists from 420-B).
