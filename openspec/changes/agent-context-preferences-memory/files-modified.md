## Backend

- `backend/src/main/scala/com/helio/services/AgentMemoryService.scala` — added `touch(id, user): Future[Unit]`, delegating to `AgentMemoryRepository.touch` (420-B). Called only from `WorkspaceContextService.assemble`, never from the MCP read path.
- `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` — added `WorkspaceContextAgentSection(preferences, memory)` case class + `.empty` default, added `agentContext: WorkspaceContextAgentSection` to `WorkspaceContextResponse`, mixed `AgentPreferencesProtocol`/`AgentMemoryProtocol` into `WorkspaceContextProtocol`'s `extends` chain for their formatters, bumped `workspaceContextResponseFormat` to `jsonFormat9`.
- `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` — added `agentPreferencesServiceOpt`/`agentMemoryServiceOpt` (default-`None`, trailing) constructor params; added `buildAgentContext` (composes preferences + top-20 ranked memory, touches every surfaced entry, empty default when either service is absent) and `rankMemoryEntries` (pure, `private[services]`, touched-first-by-`lastUsedAt`-desc then never-used in incoming order); wired `agentContextF` into `assemble`'s `for`-comprehension and the constructed `WorkspaceContextResponse`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — threaded the already-constructed `agentPreferencesServiceOpt`/`agentMemoryServiceOpt` values into `WorkspaceContextService`'s one construction site.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringPrompt.scala` — added `agentContextSection` (compact preferences summary + memory bullet list, `""` when both empty) and `preferencesSummary` helpers; `userMessage` gained an `agentContext` parameter and appends the rendered section after `groundingSection`'s output.
- `backend/src/main/scala/com/helio/services/DashboardAuthoringService.scala` — `initialUserMessage` now threads `ctx.workspace.agentContext` into `DashboardAuthoringPrompt.userMessage`.
- `backend/src/test/scala/com/helio/services/WorkspaceContextServiceApplyBudgetSpec.scala` — added `agentContext = WorkspaceContextAgentSection.empty` to the `baseResponse` test fixture (new required field).
- `backend/src/test/scala/com/helio/services/WorkspaceContextServiceAgentContextSpec.scala` (new) — DB-backed coverage: `agentContext` population, empty defaults (neither stored; services absent), top-20 ranking (touched-desc then never-used), and the touch-vs-not-touched side effect.
- `backend/src/test/scala/com/helio/services/DashboardAuthoringPromptSpec.scala` (new) — `agentContextSection`/`userMessage` rendering coverage, including the empty-input → empty-string case.

## Schema

- `schemas/workspace-context.schema.json` — added `agentContext` to `required`/`properties`, with `$defs.AgentContext`/`AgentPreferences`/`AgentMemoryEntry` mirroring the backend wire shapes (self-contained, not cross-file `$ref`, matching this schema's existing convention).

## MCP (helio-mcp)

- `helio-mcp/src/types.ts` — added `AgentPreferencesResponse`/`AgentMemoryEntryResponse` interfaces mirroring the backend wire DTOs.
- `helio-mcp/src/helioApi.ts` — added `HelioApi.getAgentPreferences()`/`listAgentMemory()` (thin `GET` pass-throughs).
- `helio-mcp/src/context.ts` — added `agentContext` field to `WorkspaceContext`; added `rankMemoryEntries` (exported, pure, mirrors the backend's ranking) and `buildAgentContext` (two independently `.catch`-guarded fetches, kicked off outside the existing fail-fast `Promise.all`, never touches memory); wired into `buildWorkspaceContext`.
- `helio-mcp/src/context.test.ts` — added default `getAgentPreferences`/`listAgentMemory` fakes to the existing `makeFakeApi` fixture (new required field) plus `agentContext = {...}` to the two hand-built `WorkspaceContext` fixtures in the `applyBudget` describe block; added `rankMemoryEntries` unit coverage and a `buildWorkspaceContext — agentContext wiring` describe block (population/ranking/cap, degrade-on-failure for each of the two fetches, empty defaults, and a real-`HelioApi`-backed test asserting no `post`/`put`/`patch`/`delete` call ever reaches `/api/agent/memory` or `/api/preferences`).
- `helio-mcp/src/tools/read.ts` — `get_workspace_context`'s tool description now mentions the `agentContext` block.
- `helio-mcp/src/index.ts` — the `helio://workspace/context` resource description now mentions `agentContext`.
