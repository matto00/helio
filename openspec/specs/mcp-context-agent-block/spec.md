# mcp-context-agent-block Specification

## Purpose
The `agentContext` block on the MCP `get_workspace_context` tool / `helio://workspace/context`
resource, surfacing the caller's agent preferences and top-N most-recently-useful memory entries
to external MCP-based agents — a read-only mirror of the backend's own grounding block, never
touching entries it surfaces.
## Requirements
### Requirement: get_workspace_context returns an agentContext block
The MCP `get_workspace_context` tool SHALL return an `agentContext` field on `WorkspaceContext`
(and the equivalent `helio://workspace/context` resource SHALL return the same field), carrying
the authenticated token's `AgentPreferences` and up to 20 of their most-recently-useful
`AgentMemoryEntry` records, ranked the same way as the backend's `agentContext.memory`
(most-recently-useful first, never-used entries last).

#### Scenario: Token owner with stored preferences and memory
- **WHEN** `get_workspace_context` runs for a token whose owner has stored preferences and more
  than 20 memory entries
- **THEN** the returned `agentContext.preferences` matches the owner's stored preferences
- **AND** `agentContext.memory` contains up to 20 entries, most-recently-useful first

#### Scenario: Token owner with neither preferences nor memory stored
- **WHEN** `get_workspace_context` runs for a token whose owner has stored neither
- **THEN** `agentContext.preferences` is an all-default/empty shape
- **AND** `agentContext.memory` is an empty list

#### Scenario: A failed preferences or memory fetch degrades that section only
- **WHEN** the `GET /api/preferences` or `GET /api/agent/memory` fetch fails during
  `buildWorkspaceContext`
- **THEN** the corresponding part of `agentContext` degrades to its empty default
- **AND** the overall `get_workspace_context` call still succeeds with the rest of the workspace
  snapshot intact

### Requirement: Surfacing memory via the MCP read path does not touch entries
Fetching memory entries via `buildWorkspaceContext`'s MCP path SHALL NOT update any entry's
`lastUsedAt` — touching is reserved for the backend NL-authoring grounding path.

#### Scenario: MCP read leaves lastUsedAt unchanged
- **WHEN** `get_workspace_context` (or the `helio://workspace/context` resource) is called and
  returns memory entries in `agentContext.memory`
- **THEN** none of those entries' `lastUsedAt` values are modified by this call

