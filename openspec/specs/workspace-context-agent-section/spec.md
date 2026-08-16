# workspace-context-agent-section Specification

## Purpose
The always-present `agentContext` section of `WorkspaceContextResponse` (assembled by
`WorkspaceContextService.assemble`), feeding the caller's stored agent preferences and their
most-recently-useful memory entries into the NL authoring flow (HEL-341), conversational
refinement (HEL-343), and `GET /api/workspace/context`, with surfaced memory entries touched so
420-B's eviction order reflects real usage.
## Requirements
### Requirement: WorkspaceContextResponse includes an always-present agentContext section
`WorkspaceContextResponse` (assembled by `WorkspaceContextService.assemble`) SHALL include an
`agentContext` field carrying the caller's `AgentPreferences` and up to 20 of their
most-recently-useful `AgentMemoryEntry` records, ranked by `lastUsedAt` descending (an entry with
no `lastUsedAt` ranks below every entry that has one). The field is always present — never
omitted — defaulting to an empty preferences object and an empty memory list when the caller has
stored neither.

#### Scenario: Caller with stored preferences and memory
- **WHEN** `WorkspaceContextService.assemble` runs for a caller with stored `AgentPreferences`
  and more than 20 stored `AgentMemoryEntry` records
- **THEN** the returned `agentContext.preferences` matches the caller's stored preferences
- **AND** `agentContext.memory` contains exactly 20 entries, ordered most-recently-useful first

#### Scenario: Caller with neither preferences nor memory stored
- **WHEN** `WorkspaceContextService.assemble` runs for a caller with no stored preferences and no
  stored memory entries
- **THEN** `agentContext.preferences` is the all-default/empty `AgentPreferences` shape
- **AND** `agentContext.memory` is an empty list

#### Scenario: agentContext degrades gracefully when the underlying services are unavailable
- **WHEN** `WorkspaceContextService` is constructed with `agentPreferencesServiceOpt = None` and/or
  `agentMemoryServiceOpt = None`
- **THEN** `assemble` still succeeds, producing an empty `agentContext` for whichever service is
  absent, rather than failing the whole context assembly

### Requirement: Surfacing a memory entry updates its lastUsedAt
Each `AgentMemoryEntry` included in `agentContext.memory` SHALL have its `lastUsedAt` updated to
the current time as part of the same `assemble` call that surfaced it, so 420-B's eviction
ordering reflects real usage.

#### Scenario: Surfaced entries are touched
- **WHEN** `WorkspaceContextService.assemble` surfaces a memory entry in `agentContext.memory`
- **THEN** that entry's `lastUsedAt` is updated to the current time
- **AND** a subsequent `AgentMemoryService.list` call for the same caller reflects the updated
  `lastUsedAt`

#### Scenario: Non-surfaced entries are not touched
- **WHEN** a caller has more than 20 memory entries and `assemble` surfaces only the top 20
- **THEN** entries NOT included in `agentContext.memory` have their `lastUsedAt` left unchanged

### Requirement: The NL authoring prompt includes the caller's agentContext
`DashboardAuthoringPrompt.userMessage`'s rendered prompt text SHALL include a compact rendering
of the grounded `agentContext` (preferences summary and memory entries) in addition to the
existing DataType grounding section.

#### Scenario: Prompt includes preferences and memory
- **WHEN** `DashboardAuthoringService` assembles grounded context for a first-turn authoring
  request, and the caller has stored preferences and memory entries
- **THEN** the rendered prompt text sent to Claude includes a section describing those
  preferences and memory entries

#### Scenario: Prompt omits the section cleanly when agentContext is empty
- **WHEN** the caller has no stored preferences and no stored memory entries
- **THEN** the rendered prompt text does not include a misleading or empty-looking
  preferences/memory section (e.g. no bare headers with nothing under them)

