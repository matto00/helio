# agent-memory-opt-out Specification

## Purpose
The `memoryEnabled` privacy opt-out flag: readable via `GET /api/preferences` and writable via a
dedicated `PUT /api/preferences/memory-enabled` endpoint (never folded into the general
full-replace preferences PUT, to protect an already-shipped, unaware caller), gating new
`AgentMemoryEntry` capture and grounding-feed surfacing while leaving the management UI's
view/delete/clear-all surface fully functional regardless of the flag.
## Requirements
### Requirement: memoryEnabled is readable via GET /api/preferences
`GET /api/preferences` SHALL include an always-present `memoryEnabled: Boolean` field, defaulting
to `true` for a caller with no stored preferences (a documented, env-var-overridable constant).

#### Scenario: New caller with no stored preferences
- **WHEN** `GET /api/preferences` is called for a user with no stored row
- **THEN** the response includes `memoryEnabled: true`

#### Scenario: Caller who has previously opted out
- **WHEN** `GET /api/preferences` is called for a user who has previously set `memoryEnabled` to
  `false`
- **THEN** the response includes `memoryEnabled: false`

### Requirement: memoryEnabled is writable via a dedicated endpoint
The backend SHALL expose `PUT /api/preferences/memory-enabled` on the authenticated route tree,
accepting `{memoryEnabled: Boolean}` and persisting only that field.

#### Scenario: Opting out
- **WHEN** a client sends `PUT /api/preferences/memory-enabled` with `{memoryEnabled: false}`
- **THEN** a subsequent `GET /api/preferences` returns `memoryEnabled: false`

#### Scenario: Opting back in
- **WHEN** a client sends `PUT /api/preferences/memory-enabled` with `{memoryEnabled: true}` for a
  caller who had previously opted out
- **THEN** a subsequent `GET /api/preferences` returns `memoryEnabled: true`

### Requirement: The general preferences PUT preserves memoryEnabled unchanged
The existing full-replace `PUT /api/preferences` endpoint SHALL leave the caller's current
`memoryEnabled` value unchanged on every call, never resetting it to the default just because its
request body (which carries no `memoryEnabled` field at all) omits it.

#### Scenario: Saving unrelated preferences does not reset memoryEnabled
- **WHEN** a caller who has previously opted out (`memoryEnabled: false`) sends
  `PUT /api/preferences` with a body updating only `defaultSeriesColors`
- **THEN** the persisted `memoryEnabled` remains `false`
- **AND** `defaultSeriesColors` is updated as requested

### Requirement: Disabled memory capture makes AgentMemoryService.add a no-op
When the caller's `memoryEnabled` is `false`, `AgentMemoryService.add` SHALL validate the request
as normal but SHALL NOT persist a new entry, returning a normal success response.

#### Scenario: add writes nothing when disabled
- **WHEN** `AgentMemoryService.add` is called for a user with `memoryEnabled: false`
- **THEN** no new row is persisted
- **AND** the call still returns a success response (not an error)

#### Scenario: add behaves normally when enabled
- **WHEN** `AgentMemoryService.add` is called for a user with `memoryEnabled: true` (the default)
- **THEN** a new entry is persisted as it would be without this ticket's changes

### Requirement: Disabled memory capture excludes memory from the grounding feed only
When the caller's `memoryEnabled` is `false`, `WorkspaceContextService.buildAgentContext` SHALL
produce an empty `agentContext.memory`, while still including `agentContext.preferences`. The
caller's stored entries SHALL remain fully visible and manageable via `GET`/`DELETE
/api/agent/memory[/:id]` regardless of `memoryEnabled`.

#### Scenario: Grounding surfaces no memory when disabled
- **WHEN** `WorkspaceContextService.buildAgentContext` runs for a user with `memoryEnabled: false`
  who has existing stored memory entries
- **THEN** `agentContext.memory` is empty
- **AND** `agentContext.preferences` still reflects the caller's stored preferences

#### Scenario: Existing entries remain visible and manageable after opting out
- **WHEN** a user with existing stored memory entries sets `memoryEnabled` to `false`
- **THEN** `GET /api/agent/memory` still returns those entries unchanged
- **AND** `DELETE /api/agent/memory/:id` and `DELETE /api/agent/memory` (clear all) still work
  exactly as before opting out

