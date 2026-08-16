## Skeptic Report — design gate (round 0, skeptic-design-1.md)

### What I verified (with evidence)

1. **Single construction site for `WorkspaceContextService` / shared assembler claim (design.md
   Context §1, Decision 1).**
   `grep -n "new WorkspaceContextService(" backend/src/main/scala/` → exactly one hit,
   `ApiRoutes.scala:304`. Confirmed all three claimed consumers use that one instance:
   - `DashboardAuthoringService` — constructed at `ApiRoutes.scala:327` passing `workspaceContextService`.
   - `RefinementGrounding` — constructed at `ApiRoutes.scala:334` passing `workspaceContextService`,
     and `RefinementGrounding.scala:80` calls `workspaceContextService.assemble(user)` directly.
   - `GET /api/workspace/context` — `WorkspaceRoutes` is constructed at `ApiRoutes.scala:549` with
     the same `workspaceContextService` instance.
   Decision 1's whole "every consumer picks this up for free" rationale is factually correct.

2. **`workspaceTeardownServiceOpt` Option-guarded precedent (Decision 2).**
   Read `ApiRoutes.scala:293-297`: `workspaceTeardownServiceOpt: Option[WorkspaceTeardownService] =
   Option(dbContext).map(...)` — a real, existing pattern. Better still: `agentPreferencesServiceOpt`
   (line 279) and `agentMemoryServiceOpt` (line 282) **already exist**, constructed unconditionally
   from `Option(agentPreferencesRepo)`/`Option(agentMemoryRepo)` — exactly the values tasks.md 2.3
   claims are "already constructed there (420-A/420-B)" and ready to thread into
   `WorkspaceContextService`'s one construction site. Verified.

3. **`AgentMemoryService`/`AgentMemoryRepository` shapes (tasks.md 1.1).**
   `AgentMemoryRepository.scala:48` already has `def touch(id: AgentMemoryId, user: AuthenticatedUser):
   Future[Unit]`. `AgentMemoryService.scala` has `add`/`list`/`delete`/`clear` but no `touch` wrapper —
   tasks.md 1.1's proposed signature (`touch(id, user): Future[Unit]` delegating to the repo) is a
   direct, unambiguous 1:1 wrapper. Confirmed. Note: `AgentMemoryService.list` returns
   `Future[Either[ServiceError, Seq[AgentMemoryEntry]]]` (never actually returns `Left`, per its own
   docstring) while `AgentPreferencesService.get` returns a bare `Future[AgentPreferences]` — a small
   asymmetry tasks.md 2.2 doesn't explicitly call out how to fold, but it's a mechanical `.getOrElse`/
   `.fold` an implementer resolves trivially; not a design defect.

4. **`AgentPreferencesResponse`/`AgentMemoryEntryResponse` field shapes.**
   Read `AgentPreferencesProtocol.scala` (`defaultSeriesColors`/`defaultPanelStyle`/
   `namingConventions`/`extras`) and `AgentMemoryProtocol.scala` (`id`/`kind`/`content`/`createdAt`/
   `lastUsedAt: Option[String]`) — match what design.md/tasks.md describe as the DTOs to mirror.

5. **`GET /api/agent/memory` returns a bare array, not `Paged<>`.**
   `AgentMemoryRoutes.scala:34-36`: `ServiceResponse.run(agentMemoryService.list(user)) { entries =>
   entries.map(AgentMemoryEntryResponse.fromDomain) }` — marshals a `Seq[AgentMemoryEntryResponse]`
   directly, no pagination envelope. Confirmed tasks.md 5.2's `listAgentMemory(): Promise<
   AgentMemoryEntryResponse[]>` (bare array) is the right client shape — and it matches an existing
   MCP-side precedent (`listPipelines(): Promise<PipelineSummaryResponse[]>`,
   `listPipelineShapes(): Promise<PipelineShapeCatalogEntryResponse[]>` in `helioApi.ts`), not a new
   convention.

6. **`helio-mcp` fan-out/degrade conventions (Decision 6, tasks.md 6.2).**
   Read `context.ts`'s `buildWorkspaceContext` in full: one `Promise.all` over one-`HelioApi`-call-
   per-resource (`listDataSources`/`listDataTypes`/.../`listMetrics`), plus a genuine per-item
   try/catch degrade precedent for `analyzePipeline` (`context.ts:1024-1037`, `steps: [],
   stepsError: err.message`, never failing the whole call). `HelioHttpClient` (`httpClient.ts:135,
   148`) confirms `HelioApi` calls **throw** on HTTP failure, so a degrade requires an explicit
   per-call catch, not reliance on the outer `Promise.all`.
   — **Note (non-blocking, self-correcting):** tasks.md 6.2's literal phrasing — "fan out
   `getAgentPreferences()` + `listAgentMemory()` **alongside the existing `Promise.all` calls**" —
   is ambiguous: read literally (adding the two calls into the SAME array passed to the existing
   `Promise.all([...])`), it would break the "degrade that section only, never fail the whole call"
   requirement, since `Promise.all` fails fast on any rejection and none of the other 6 calls in that
   array are individually caught today. The correct reading (each call wrapped in its own
   `.catch()`/try-catch, mirroring the `stepsError` precedent tasks.md cites in the very same
   sentence) is achievable and clearly signposted — and tasks.md 7.4 explicitly mandates a test
   asserting "degrade-on-failure behavior," which would catch a literal, wrong implementation before
   the ticket could pass eval. Flagging for executor awareness; not blocking design soundness.

7. **`WorkspaceContextResponse`/schema shape (tasks.md 1.2, 4.1).**
   `WorkspaceContextProtocol.scala` confirmed: current `jsonFormat8`, 8 top-level fields, no
   `metrics`/`pipelineShapes` (pre-existing, unrelated asymmetry vs. the MCP shape — outside this
   ticket's scope). `schemas/workspace-context.schema.json`'s `required`/`properties`/`$defs` exactly
   match the structure tasks.md 4.1 describes extending.
   Also verified the byte-budget mechanism absorbs the new field for free on both sides without any
   code change: backend `WorkspaceContextBudget.coreSize` uses `response.toJson.asJsObject` (generic
   reflection over every field except `truncation`); MCP `context.ts`'s `coreSize` does `const {
   truncation, ...core } = context`. Neither needs edits for `agentContext` to be counted (though not
   trimmed) by the budget — consistent with the Impact section's omission of
   `WorkspaceContextBudget.scala`/`applyBudget` from the affected-files list.

8. **Prompt-rendering wiring (Decision 5, tasks.md 3.1-3.3).**
   `DashboardAuthoringPrompt.userMessage(goal, dataTypes, capabilities)` confirmed as the sole,
   single-call-site function (`DashboardAuthoringService.scala:158`, inside `initialUserMessage`).
   `GroundedContext.workspace: WorkspaceContextResponse` (`DashboardAuthoringService.scala:74`)
   confirms `ctx.workspace.agentContext` will be reachable once the field lands. Only one call site
   exists for `userMessage` in the whole backend — a signature change is safe.

9. **Decision 3 (N=20, `lastUsedAt` descending, nulls-last) and Decision 4 (touch on backend path
   only, not MCP) assessed as engineering judgment, not just asserted.**
   N=20 follows the codebase's established "documented constant, not unbounded" discipline
   (`SampleRowLimit`/`MaxJoinHints`/etc. in `WorkspaceContextService.scala` are the same pattern) and
   directly serves AC4 ("payload stays compact, documented entry cap"). Decision 4's rationale is
   grounded in the actual mechanics of the eviction cap (per 420-B) — a passive MCP read (e.g. via
   the `helio://workspace/context` resource, attachable as ambient context by any client) has no
   correlation to actual use, so touching it would let polling artificially keep stale entries alive,
   defeating LRU eviction's purpose. Both are reasoned from the ticket's actual acceptance criteria
   and existing code discipline, not merely plausible-sounding.

10. **Naming correction section.** Verified `openspec/changes/archive/2026-08-16-user-preference-store/`
    exists in this worktree, backing the ticket's claim that 420-A shipped as `AgentPreferencesService`
    (not the ticket-text's original `UserPreferencesService`). The rest of this change's artifacts
    (proposal/design/tasks/specs) consistently use `AgentPreferencesService` throughout — no stale
    references to the pre-rename name found via `grep -rn "UserPreferencesService"` across
    proposal.md/design.md/tasks.md/specs/.

### Verdict: CONFIRM

The two-surface design is sound: every load-bearing factual claim in design.md (single construction
site, Option-guarded-dependency precedent, existing service/repo shapes, bare-array `/api/agent/memory`
response, MCP fan-out/degrade conventions) checks out against the actual code, not just against the
executor's/an earlier agent's narrative. The judgment calls (N=20, touch-only-on-backend-path) are
grounded in real codebase precedent and the ticket's actual acceptance criteria, not hand-waved. Tasks
map cleanly onto both spec deltas' scenarios, and the one genuinely fuzzy phrasing (tasks.md 6.2's
Promise.all wording) is self-correcting via the test tasks.md itself mandates (7.4).

### Non-blocking notes

- tasks.md 6.2: when implementing, make sure `getAgentPreferences()`/`listAgentMemory()` are each
  wrapped in their own `.catch()`/try-catch (mirroring the `stepsError` per-item pattern), NOT folded
  into the existing fail-fast `Promise.all([...])` array — the latter would silently break the
  "degrade that section only" requirement (spec `mcp-context-agent-block/spec.md` scenario 3).
- tasks.md 2.2: `AgentMemoryService.list`'s `Future[Either[ServiceError, Seq[...]]]` return type
  (vs. `AgentPreferencesService.get`'s bare `Future[AgentPreferences]`) isn't explicitly reconciled in
  the task text — a one-line `.fold`/`.getOrElse` resolves it, no design change needed.
- Decision 5's "appended after the existing `groundingSection(...)` call" doesn't pin down whether the
  new section goes before or after the final `"\n\nUser goal: " + goal` suffix in `userMessage`'s
  concatenation — functionally immaterial to the spec's scenarios (which only assert presence/absence
  of the section's text), but worth a one-line clarification in the implementation for readability.
