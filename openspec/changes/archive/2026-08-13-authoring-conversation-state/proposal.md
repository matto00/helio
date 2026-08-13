## Why

HEL-392/HEL-395 shipped single-shot NL authoring: one goal, one proposal, no iteration. Users will
want to refine before applying ("make the second panel a bar chart") without starting over. This
ticket adds that — server-persisted conversation state so the same proposal is revised turn over
turn, reusing HEL-392's existing message-threading machinery almost entirely as-is.

## What Changes

- `DashboardAuthoringService.author`/`authorStreaming` gain an optional `conversationId`: absent →
  today's single-shot behavior, unchanged, but now also persisted as turn 1 of a resumable
  conversation; present → loads the persisted (owner-scoped) history, appends the new turn, re-runs
  the existing parse→validate→repair core unchanged, persists the result.
- New `authoring_conversations` table (Flyway `V77`, verified against this worktree's actual current
  head, not the ticket's stale note) storing turns + the latest working proposal as JSONB, RLS-scoped
  to the owner, mirroring `V75__metrics.sql`'s direct-owner pattern exactly.
- Retained history is trimmed deterministically (oldest turns first, via the existing
  `ClaudeTokenEstimator`) before each Claude call — never summarized (an LLM call would be costed
  and nondeterministic).
- A new per-conversation accumulated-token ceiling (distinct from `ClaudeClient`'s per-request
  guardrail) rejects further turns on an exhausted conversation with a clear `422`.
- Frontend: the drawer renders a multi-turn thread (read-only progress log; editing still happens
  once, in the existing `ProposalReview` UI after "review & apply"). Local component state, not
  Redux, mirroring HEL-395's own D1 reasoning for this exact drawer.

## Capabilities

### New Capabilities

- `authoring-conversation-state`: server-persisted, owner-scoped, multi-turn refinement of a
  `DashboardProposal` before it's ever applied — conversation storage, history trimming, and the
  per-conversation token ceiling.

### Modified Capabilities

- `nl-dashboard-proposal-authoring` (HEL-392): `DashboardAuthoringRequest` gains an additive optional
  `conversationId`; `DashboardAuthoringResponse`/the streaming terminal event gain a `conversationId`
  the caller can pass on the next turn. No existing field changes meaning; single-shot (no
  `conversationId`) behavior is observably unchanged — its existing requirement's own text updates
  to name the additive field.

(`nl-authoring-chat-surface` (HEL-395) is NOT listed here: the multi-turn thread behavior is purely
additive — none of its existing requirements' text changes — so it's captured as new requirements
under the new capability below, not a delta against HEL-395's spec.)

## Impact

- New: `backend/src/main/resources/db/migration/V77__authoring_conversations.sql`,
  `AuthoringConversationRepository.scala`, matching tests.
- Modified: `DashboardAuthoringProtocol.scala`/`Service.scala`/`Routes.scala` (additive fields +
  persistence wiring), `AuthoringChatDrawer.tsx`/`useDashboardAuthoringStream.ts` (multi-turn).
- New/modified JSON schemas for the additive request/response fields.
- No database migration to any *existing* table. No frontend Redux slice added.
