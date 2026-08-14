# Top-Level In-App Assistant — Design Spec

## Summary

Replace the dashboard-scoped `AuthoringChatDrawer` (HEL-341/HEL-395) with a top-level assistant: a persistent "Chat" nav section that stores recent conversations, plus a single inline entry point reachable from any screen. The assistant reasons over the _whole_ workspace (dashboards, sources, pipelines, DataTypes, metrics) via a bounded, hard-capped tool-calling loop instead of either today's single-shot dashboard-only context dump or the external MCP surface's fully open-ended tool access — closing the gap between the two.

## Motivation / problem

Two things prompted this redesign:

1. **Scope gap.** HEL-392's `DashboardAuthoringService` only produces `DashboardProposal`s and requires a pre-existing pipeline-output `DataType` — it can't create a data source or pipeline. HEL-342 already built that broader capability (`CombinedProposalService`, HEL-387) but only exposed it via `helio-mcp` for external agents, never the in-app chat. A user asking the in-app assistant to "build me a dashboard from this CSV" can't do that today.
2. **Context-cost ceiling.** `WorkspaceContextService` (723 lines) eagerly assembles and dumps the _entire_ workspace — every source, DataType (with columns, sample rows, column stats, semantic hints), pipeline, dashboard, and metric — into a single prompt on every authoring call. This doesn't scale: as a workspace grows, cost/latency grow with it, and large workspaces risk tripping HEL-390's existing `CLAUDE_MAX_INPUT_TOKENS` guardrail outright. It also doesn't fit a top-level assistant that needs to reason across resource types on demand rather than assuming "the dashboard I'm scoped to" is the whole picture.

## Non-goals / explicitly deferred

- **Semantic/embedding search.** `find` starts as keyword/substring matching over existing name/description fields. No vector store, no embeddings pipeline for v1.
- **Cross-conversation agent memory / personalization.** The system prompt is static guardrail text plus the current conversation's own history only. HEL-420 (Agent Memory & Preferences) remains a separate, later epic; this design's system-prompt construction is built so memory can plug in later without a redesign.
- **Visual/UI design of the new chat surface.** This spec defines architecture, data flow, and entry points — not the actual look and feel. The current drawer's design is explicitly not being ported as-is ("not thrilled about the design, it will definitely need an upgrade"); the new chat surface needs its own UI design pass against `DESIGN.md`, scoped as its own ticket.
- **Retention/archival mechanics** for unpinned conversations beyond the most recent 10 (hard delete vs. hide-from-default-list) — left as an implementation-time decision, not a spec-level one.

## Architecture

A new backend `AssistantService` becomes the entry point, superseding `DashboardAuthoringService` (whose validation/proposal-construction logic it reuses, not discards). Shape of one conversational turn:

```
User message → AssistantService.converse(conversationId, message)
  → loads conversation history (Postgres metadata + GCS transcript body) + static system prompt
  → ClaudeClient.sendWithTools(history, tools=[find, get_resource,
                                                propose_dashboard, propose_pipeline,
                                                propose_combined, propose_patch_set])
  → bounded loop, hard cap 3 hops:
       tool_use(find | get_resource) → execute → feed tool_result back, continue loop
       tool_use(propose_*)           → execute against existing service → feed result back, continue loop
       final text / proposal          → break
  → persist the full turn (messages + tool calls) → stream progress events to the frontend
```

`find` and `get_resource` execute against the same underlying repositories `WorkspaceContextService` already reads, but return compact summaries (id, type, name, one-line description) from `find`, with full per-resource detail (pipeline steps, DataType columns/samples/stats, dashboard panels, metric definition) only from a targeted `get_resource(id, type)` call. The `propose_*` tools are thin wrappers around the already-shipped `DashboardProposalService` / `CombinedProposalService` / `PipelineProposalService`, plus HEL-343's forthcoming patch-set apply path — no new mutation logic.

**Hard boundary: `apply` is never a tool.** Claude can only ever propose. Applying a proposal remains a separate, explicit user action (Accept in the existing Proposal Review UI) after human review — unchanged from today. This preserves the propose → review → apply invariant every epic this cycle has been built around; the assistant must never be able to mutate the workspace unilaterally mid-conversation.

The one genuinely new backend primitive this requires: `ClaudeClient` (HEL-390) gains tool-use support (parsing `tool_use` content blocks, executing, feeding `tool_result` back, looping under the hard cap). Today it only does single send/stream.

## Data model & persistence

- New table `assistant_conversations`: `id`, `userId`, `title` (derived from first message or user-renamed), `pinned` (bool), `createdAt`, `updatedAt`, `gcsBodyRef`.
- Transcript body (messages + tool calls) stored as a JSON blob via the _existing_ uploads-backend abstraction (`HELIO_UPLOADS_BACKEND=gcs` / `HELIO_UPLOADS_BUCKET`), under a new path prefix (e.g. `assistant-conversations/{userId}/{conversationId}.json`) — reusing established infra rather than standing up new bucket/IAM wiring.
- List query: `ORDER BY pinned DESC, updatedAt DESC`; default view shows the 10 most recent unless pinned. Hard-delete vs. hide-only for anything beyond that is an implementation-time call (see Non-goals).

## UI entry points

One underlying chat session; **exactly one entry point to the assistant per page** — no more per-feature buttons (e.g. the current "magic wand" button next to Create Dashboard in `DashboardList.tsx` is removed):

1. **Chat nav destination** (`/chat`, new entry in `navDestinations.ts`) — the conversation list (reusing the `SidebarItemList` pinned/recent pattern) plus the active conversation panel. This is the full "browse history" surface.
2. **Inline quick-launcher** — a single persistent affordance in the app command bar, available on every screen, opening the _same_ active conversation as an overlay rather than navigating away, so a user on `/pipelines/:id` can prompt without losing their place.

This is a **big-bang replacement**, not a parallel rollout — `AuthoringChatDrawer`'s current mount point and the scattered per-feature entry buttons are retired as part of this work, not kept running alongside the new surface.

**Reuse vs. rework:**

- Reused as-is: `ProposalReviewPage.tsx` / `ProposalReview.tsx` (untouched apply target), `DashboardProposalService` / `CombinedProposalService` / `PipelineProposalService` (wrapped, not rewritten), `ClaudeConfig`/secret wiring (HEL-390), the GCS uploads-backend abstraction, `SidebarItemList` pattern, HEL-401's error/guardrail UX and telemetry patterns.
- Reworked: the chat message list/composer UI itself (needs a real design pass, not a port), `useDashboardAuthoringStream`'s event shape (needs new event types for tool-call/search progress, not just text/proposal events), `DashboardAuthoringService` (superseded by `AssistantService`, logic folded in as the `propose_dashboard` tool's backing).
- Removed: per-feature quick-launcher buttons throughout the app (e.g. next to Create Dashboard); `AuthoringChatDrawer`'s current drawer chrome.

## Tool surface & system prompt

Tools: `find(query, resourceTypes?)`, `get_resource(id, type)`, `propose_dashboard`, `propose_pipeline`, `propose_combined`, `propose_patch_set`. No `apply` tool (see Architecture).

System prompt: static text covering role ("Helio's dashboard/pipeline assistant"), the available tools and when to use each, the hard 3-hop cap stated explicitly so the model paces itself, and the propose-never-apply boundary. Carries forward HEL-401's guardrail wording (budget rejection, no fabricated resource ids) rather than reinventing it.

**Fallback behavior falls out of this by construction, not special-casing**: when `find` returns nothing relevant to a goal, the system prompt guides Claude to reach for `propose_pipeline`/`propose_combined` instead of dead-ending on `propose_dashboard` alone — this is exactly the "build me a dashboard from this CSV" gap identified in Motivation, closed automatically once the broader tool set is available.

## Error handling

Extends HEL-401's already-shipped patterns rather than inventing new ones:

- `find` returns zero results → Claude asks a clarifying question rather than guessing.
- Hop cap hit (3 tool calls used, no final answer) → a clear "I couldn't find enough in 3 lookups — can you narrow this down?" message. Graceful give-up, not a silent failure or a forced low-quality guess.
- Tool execution error (e.g. `get_resource` on a deleted/inaccessible id) → fed back to Claude as a tool result so it can recover within the remaining hop budget, instead of crashing the turn.
- Telemetry: extend HEL-401's goal→proposal→apply outcome tracking to also record tool calls per turn and whether the hop cap was hit.

## Testing strategy

Same deterministic-fixture philosophy as HEL-392's bounded self-repair test (a fake transport that throws on a 3rd call): a fake tool executor with scripted `find → find → answer` sequences, plus a fixture asserting the loop hard-caps (terminates gracefully on a 4th `tool_use` attempt). No real network calls in the automated suite.

## Relationship to existing tickets

**Nothing from HEL-341 is wasted:**

- `ClaudeClient` (HEL-390) — extended, not rebuilt.
- `DashboardAuthoringService` (HEL-392) — logic reused inside `propose_dashboard`.
- HEL-401's error/guardrail UX + telemetry — carried forward directly.
- Retired: `AuthoringChatDrawer`'s mount point and the single-shot-only code path (becomes one possible outcome of the bounded loop, not the only way in).

**HEL-343 (Conversational Refinement, in progress) is unaffected and feeds this design** — its patch-set schema/apply/undo work becomes the backing for `propose_patch_set`. HEL-328 (MCP PATCH tools, merged) and the rest of HEL-343's children are surface-agnostic mutation primitives regardless of where the chat UI lives.

**HEL-420 (Agent Memory, Backlog)** stays deferred per the Non-goals section.

**HEL-631** ("Split WorkspaceContextService — grown past size guidance") **remains independently valid, not superseded** — `WorkspaceContextService` continues to back the unchanged MCP `get_workspace_context` resource for external agents; this design adds new `find`/`get_resource` methods alongside it rather than replacing it. Cross-reference only, no scope change to HEL-631.

**HEL-577** ("Template → agent...", child of HEL-421) references HEL-341 by name in its description; needs a comment noting its entry point will move once this ships. Not blocking, not resolved in this spec.

**Explicitly not created**: the two tickets drafted earlier in this conversation (backend combined-proposal wiring + frontend combined-proposal UI for the _old_ dashboard-scoped drawer) are superseded by `propose_combined` in this design and will not be filed separately.

## Open questions (none blocking — noted for the implementation plan/tickets)

- Exact `find` ranking/matching algorithm (simple substring vs. something better) when result counts are large.
- Whether `get_resource` is a distinct tool or an id-lookup mode of `find`.
- Visual treatment of the inline quick-launcher (floating bubble vs. command-bar icon vs. keyboard shortcut) — deferred to the UI design ticket.
- Conversation retention mechanics beyond the 10-most-recent-or-pinned view.
