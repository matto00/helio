## Context

HEL-521 (420-C) is the third ticket of the Agent Memory & Preferences epic (HEL-420), unblocked
now that 420-A (HEL-472, `AgentPreferences`) and 420-B (HEL-478, `AgentMemoryEntry`) are both
merged. It has two genuinely independent integration surfaces that happen to share one ticket:

1. **Backend grounding** — `WorkspaceContextService.assemble` (HEL-371) is the single, already-
   shared assembler behind `DashboardAuthoringService` (HEL-341's `POST /api/authoring/dashboard`),
   `RefinementGrounding` (HEL-343), and the raw `GET /api/workspace/context` route
   (`WorkspaceRoutes.scala`) — confirmed via `grep -rn "new WorkspaceContextService("
   backend/src/main/scala/`: exactly one construction site, in `ApiRoutes.scala`. Extending this
   one assembler is therefore the "extend the aggregated endpoint" path the ticket calls for,
   and every consumer inherits it automatically.
2. **MCP grounding** — `helio-mcp/src/context.ts`'s `buildWorkspaceContext` is a genuinely
   separate, client-side TypeScript re-implementation (documented in its own header comment: "no
   shared runtime between backend and helio-mcp... duplicating the rules"). It does its own
   `Promise.all` fan-out over REST endpoints rather than calling `GET /api/workspace/context`.

## Goals / Non-Goals

**Goals:**
- The NL authoring flow's actual grounding — both the wire response AND the text prompt sent to
  Claude — includes the caller's preferences and their most-recently-useful memory entries.
- Surfacing a memory entry through the backend grounding path touches it, so 420-B's eviction
  order reflects real usage (ticket AC2).
- `get_workspace_context` (MCP) returns the same shape of information for external agents.
- The added section stays compact and additive — existing consumers of both `WorkspaceContext`
  shapes are unaffected by the new field.

**Non-Goals:**
- Automatic memory extraction from conversation text (HEL-341/HEL-343's own concern, explicitly
  out of scope per the ticket).
- Management UI (420-D) or privacy opt-out (420-E).
- Touching memory entries surfaced via the MCP read path (see Decision 4).

## Decisions

**Decision 1 — extend `WorkspaceContextService.assemble`/`WorkspaceContextResponse` directly,
not a new endpoint.** Confirmed exactly one construction site
(`ApiRoutes.scala:304`), so every consumer (`DashboardAuthoringService`, `RefinementGrounding`,
`WorkspaceRoutes`) picks up the new field automatically — the ticket's own "if that flow reads an
aggregated endpoint, extend it" branch. Alternative considered: a standalone
`GET /api/agent/context` the authoring flow would additionally call — rejected as an unnecessary
second round trip when the existing assembler is already shared and already the thing
`DashboardAuthoringService.assembleGroundedContext` calls once per turn-1 request.

**Decision 2 — `agentContext` is `Option`-guarded at the constructor level, always-present at the
wire level.** `WorkspaceContextService` gains `agentPreferencesServiceOpt:
Option[AgentPreferencesService]` and `agentMemoryServiceOpt: Option[AgentMemoryService]`
constructor parameters, mirroring `WorkspaceRoutes`'s existing `workspaceTeardownServiceOpt`
nullability precedent (same underlying reason: the repositories these services wrap are
nullable in some fixtures/deployments, per `ApiRoutes.scala`'s established
`agentPreferencesRepo: AgentPreferencesRepository = null` pattern). When either is `None`,
`assemble` produces an empty `agentContext` (`AgentPreferencesResponse` all-default,
`memory: []`) rather than failing — the wire field itself is never `Option`-wrapped or omitted
(matches `WorkspaceContextResponse`'s existing "always present, never omitted" convention for
`dashboards`/`metrics`/`joinHints`).

**Decision 3 — top-N surfaced memory, N=20, ranked by `lastUsedAt` (nulls-last), never-used
entries ranked below touched ones.** `AgentMemoryEntry.lastUsedAt.getOrElse(createdAt.minusSeconds(
Long.MaxValue))`-equivalent ordering (in practice: sort by `lastUsedAt` descending with `None`
treated as oldest) over the caller's up-to-100 entries (`AgentMemoryService.list`, already
newest-`createdAt`-first — re-sorted here, not re-fetched). `N=20` is a self-approved tunable
(no existing codebase precedent for this specific cap; follows the same "documented constant,
not unbounded" discipline as `WorkspaceContextService`'s existing `SampleRowLimit`/
`MaxJoinHints`/etc.) — a fifth of the 420-B hard cap, keeping the section compact per AC4 while
still surfacing a meaningful slice.

**Decision 4 — touch happens on the backend grounding path only, never on the MCP read path.**
The ticket's "Backend" scope bullet explicitly calls out `AgentMemoryService.touch` on entries
surfaced; the "MCP" scope bullet does not mention touch at all — read as intentional, not an
omission. Rationale: the eviction cap's purpose (per 420-B's own design.md) is to protect entries
actually useful to the NL-authoring/refinement flows that *consume* grounding to produce
proposals; an MCP client's `get_workspace_context` call (also used for simple inspection, e.g. by
`fable` or any MCP client attaching it as ambient context via the `helio://workspace/context`
resource) is a read with no guaranteed correlation to the entry actually being used for anything.
Touching on every MCP read would let a client that merely polls `get_workspace_context`
repeatedly keep stale entries artificially alive, defeating the eviction mechanism's purpose.
`AgentMemoryService.touch` (new) is called only from `WorkspaceContextService.assemble`, and only
when `agentMemoryServiceOpt` is present.

**Decision 5 — the prompt rendering is a new, small, self-contained function, not folded into
`groundingSection`.** `DashboardAuthoringPrompt` gains `agentContextSection(agentContext:
WorkspaceContextAgentSection): String`, appended after the existing `groundingSection(...)` output
via `userMessage`'s existing string-concatenation shape. Kept separate (not interleaved with the
per-DataType grounding text) so a compact "the user generally prefers/knows..." block reads as
its own paragraph to the model, and so `groundingSection`'s existing, already-tested signature is
untouched.

**Decision 6 — MCP fetches preferences/memory via two new, independent `HelioApi` calls, not a
single aggregated one.** Matches the ticket's explicit instruction and the existing
`buildWorkspaceContext` convention of one `HelioApi` call per resource kind
(`listDataSources`/`listDataTypes`/`listPipelines`/etc., composed via `Promise.all`). A failed
preferences or memory fetch degrades that one section to empty (mirrors the existing
per-pipeline-analyze degrade-not-fail precedent already in `buildWorkspaceContext` for
`stepsError`), never fails the whole `get_workspace_context` call.

## Risks / Trade-offs

- [Risk] Touching the same top-N entries on every authoring-flow grounding call creates a
  feedback loop: entries already ranked in the top 20 keep getting `touch`ed, keeping them
  permanently at the front of the ranking and effectively never rotating in older, untouched
  entries (short of the untouched entries actually accumulating enough count to force
  eviction pressure elsewhere in 420-B's cap). → Mitigation: this is the ticket's own explicit,
  requested behavior ("touch entries surfaced so LRU eviction reflects real usage") — a
  self-reinforcing "the agent's active facts stay warm" property is the intended outcome, not an
  accidental one; flagged here so the skeptic/human can independently confirm intent, not
  silently assumed.
- [Risk] Two independent implementations (Scala ranking/touch vs. TypeScript ranking-only) could
  drift out of sync (e.g. N changed on one side, not the other). → Mitigation: same accepted,
  already-established trade-off as every other backend/MCP context-parity pair in this codebase
  (`WorkspaceContextService.scala`'s own header comment documents this exact deliberate
  duplication); both sides get an inline comment cross-referencing the other's constant.
