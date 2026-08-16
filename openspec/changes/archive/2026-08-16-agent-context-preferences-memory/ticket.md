# HEL-521: Feed preferences + memory into agent authoring context

## Description

The preference store (420-A / HEL-472) and agent-memory store (420-B / HEL-478) are inert until the agent actually READS them when authoring. This ticket wires both into the grounding context so in-app NL authoring (HEL-341) and conversational refinement (HEL-343) start warm instead of cold. It complements the existing workspace-context grounding (`helio-mcp/src/context.ts`, `buildWorkspaceContext`), which today covers data sources / DataTypes / pipelines / dashboards but nothing user-specific.

## Scope

- Backend: expose the caller's preferences + bounded memory to the agent grounding path. Add a compact `agentContext` section (preferences summary + top-N memory entries by `lastUsedAt`) to whatever assembler HEL-341's authoring flow consumes; if that flow reads an aggregated endpoint, extend it, otherwise add a read used by it. Touch `UserPreferencesService` (420-A) and `AgentMemoryService` (420-B); call `AgentMemoryService.touch` on entries surfaced so LRU eviction reflects real usage.
- MCP: extend `helio-mcp/src/context.ts` `WorkspaceContext` with an optional `preferences` + `memory` block (fetched via new `HelioApi` methods hitting `/api/preferences` and `/api/agent/memory`), and mention it in the `get_workspace_context` tool description (`helio-mcp/src/tools/read.ts`). Keep the payload compact per the context.ts call-budget note.
- Types: `helio-mcp/src/types.ts` additions; keep everything additive.
- No FQNs inlined in Scala.

## Acceptance criteria

- [ ] The agent grounding context returned to the NL authoring flow includes the caller's preferences and up to N most-recently-useful memory entries.
- [ ] Surfacing a memory entry updates its `lastUsedAt` (so the 420-B eviction order reflects usage), verified by a test.
- [ ] `get_workspace_context` (MCP) returns the new `preferences`/`memory` block for the authenticated token; absent/empty when the user has none.
- [ ] Payload stays compact (documented entry cap); existing context consumers are unaffected (additive fields).
- [ ] `sbt test` + `npm test` (helio-mcp) pass; no FQNs inlined.

## Out of scope

- Automatic capture/extraction of new memory from conversations (authoring/refinement work in HEL-341/HEL-343).
- Management UI (420-D) and privacy opt-out (420-E).

## Dependencies

- Blocked by 420-A (HEL-472), 420-B (HEL-478), and In-App NL Authoring (HEL-341). Relates to Conversational Refinement (HEL-343). All three are Done as of this ticket's Planning.

## Naming correction (Planning)

The ticket text above references `UserPreferencesService` (420-A). That was 420-A's ticket's
*original* proposed name; HEL-472 actually shipped it as `AgentPreferencesService` (backed by
`agent_preferences`), per a human-approved Planning-time escalation resolving a naming collision
with an unrelated, pre-existing UI-theming feature (see HEL-472's archived
`openspec/changes/archive/2026-08-16-user-preference-store/ticket.md`). This ticket uses the
actual shipped name, `AgentPreferencesService`, throughout.
