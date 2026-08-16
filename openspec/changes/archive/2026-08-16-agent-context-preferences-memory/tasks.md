## 1. ### Backend — wire shape + service

- [x] 1.1 Add `AgentMemoryService.touch(id: AgentMemoryId, user: AuthenticatedUser): Future[Unit]`
      delegating to `AgentMemoryRepository.touch` (which already exists from 420-B).
- [x] 1.2 Add `WorkspaceContextAgentSection(preferences: AgentPreferencesResponse, memory:
      Vector[AgentMemoryEntryResponse])` to `backend/src/main/scala/com/helio/api/protocols/
      WorkspaceContextProtocol.scala`, mix its formatter into `WorkspaceContextProtocol`'s
      `extends` chain (or add directly, since it's the same protocol file the existing
      `WorkspaceContext*` types already live in), and add `agentContext:
      WorkspaceContextAgentSection` to `WorkspaceContextResponse`.

## 2. ### Backend — assembly + touch side effect

- [x] 2.1 Add `agentPreferencesServiceOpt: Option[AgentPreferencesService]` and
      `agentMemoryServiceOpt: Option[AgentMemoryService]` constructor parameters to
      `WorkspaceContextService`, per design.md Decision 2.
- [x] 2.2 In `WorkspaceContextService.assemble`, compose a new `agentContextF` fetch: when both
      services are present, `AgentPreferencesService.get(user)` + `AgentMemoryService.list(user)`,
      re-sort the listed entries by `lastUsedAt` descending (`None` last) per design.md Decision 3,
      take the top 20, `touch` each surfaced entry's id via `AgentMemoryService.touch`, then build
      `WorkspaceContextAgentSection`. When either service is absent, produce the empty default
      instead (design.md Decision 2). Fold into the existing `for`-comprehension in `assemble`.
- [x] 2.3 Wire `agentPreferencesServiceOpt`/`agentMemoryServiceOpt` into `WorkspaceContextService`'s
      one construction site in `backend/src/main/scala/com/helio/api/ApiRoutes.scala:304`, passing
      the existing `agentPreferencesServiceOpt`/`agentMemoryServiceOpt` values already constructed
      there (420-A/420-B).

## 3. ### Backend — NL authoring prompt

- [x] 3.1 Add `DashboardAuthoringPrompt.agentContextSection(agentContext:
      WorkspaceContextAgentSection): String` rendering a compact preferences summary + memory
      bullet list, returning an empty string when both are empty (design.md Decision 5).
- [x] 3.2 Call it from `DashboardAuthoringPrompt.userMessage`, appending its output after the
      existing `groundingSection(...)` call (skip the append entirely when the section is empty,
      per the "no bare headers" spec scenario).
- [x] 3.3 Thread `ctx.workspace.agentContext` from `DashboardAuthoringService.initialUserMessage`
      into the new `userMessage` parameter.

## 4. ### Backend — schema

- [x] 4.1 Update `schemas/workspace-context.schema.json`: add `agentContext` to `required` and
      `properties`, with a `$defs` entry mirroring `AgentPreferencesResponse`/
      `AgentMemoryEntryResponse`'s shapes.

## 5. ### MCP — types + API client

- [x] 5.1 Add `AgentPreferencesResponse`/`AgentMemoryEntryResponse` interfaces to
      `helio-mcp/src/types.ts`, mirroring the backend wire DTOs field-for-field.
- [x] 5.2 Add `getAgentPreferences(): Promise<AgentPreferencesResponse>` (→ `GET /api/preferences`)
      and `listAgentMemory(): Promise<AgentMemoryEntryResponse[]>` (→ `GET /api/agent/memory`) to
      `helio-mcp/src/helioApi.ts`'s `HelioApi` class.

## 6. ### MCP — context assembly

- [x] 6.1 Add an `agentContext: { preferences: AgentPreferencesResponse; memory:
      AgentMemoryEntryResponse[] }` field to `WorkspaceContext` in `helio-mcp/src/context.ts`.
- [x] 6.2 In `buildWorkspaceContext`, fetch `getAgentPreferences()` and `listAgentMemory()` via
      their OWN separate `.catch`-guarded calls — explicitly NOT added into the existing
      fail-fast `Promise.all([...])` array, since a rejection there would fail the whole call
      instead of degrading only the `agentContext` section (mirrors the existing per-pipeline
      `stepsError` degrade-not-fail precedent, which is also implemented as its own isolated
      catch, not inside that same `Promise.all`). Re-sort the listed entries by `lastUsedAt`
      descending (`None`/`undefined` last, mirroring the backend's ranking — same `N=20` constant,
      independently defined per design.md Decision 6), take the top 20.
- [x] 6.3 Update `get_workspace_context`'s tool description (`helio-mcp/src/tools/read.ts`) and the
      `helio://workspace/context` resource description (`helio-mcp/src/index.ts`) to mention the
      new `agentContext` block.

## 7. ### Tests

- [x] 7.1 Add `WorkspaceContextServiceSpec` (or extend the existing one) coverage: `agentContext`
      populated correctly for a caller with preferences+memory; empty defaults when neither is
      stored; empty defaults when `agentPreferencesServiceOpt`/`agentMemoryServiceOpt` are `None`;
      top-20 ranking by `lastUsedAt` (nulls-last) is correct when more than 20 entries exist.
- [x] 7.2 Add a test proving surfaced entries are touched (their `lastUsedAt` changes) and
      non-surfaced entries are not (per the persistence spec's two touch scenarios).
- [x] 7.3 Add a `DashboardAuthoringPromptSpec` (or extend the existing prompt test) covering
      `agentContextSection`'s rendering, including the empty-input → empty-string case.
- [x] 7.4 Add/extend a helio-mcp test (`context.test.ts` or similar) covering `agentContext`'s
      fetch, ranking, and degrade-on-failure behavior, and asserting no write call
      (`put`/`post`/`delete`) is made to `/api/agent/memory` from the MCP read path (proves the
      no-touch requirement).
- [x] 7.5 Run `sbt test` + `npm test` (helio-mcp); confirm no FQNs inlined per CONTRIBUTING.md.
