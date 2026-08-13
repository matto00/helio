## Context

`DashboardAuthoringService` (HEL-392) already threads `Vector[ClaudeMessage]` through `runAttempt`/
`runRepair`/`streamAttempt`/`completeStream`/`runStreamingRepair` — multi-turn support mostly means
seeding that vector from persisted history instead of always starting from one fresh user message.
`ClaudeRequest(messages: Seq[ClaudeMessage])` (HEL-390) already accepts a full conversation.
`ClaudeTokenEstimator.estimate(messages: Seq[ClaudeMessage]): Int` (HEL-390, jtokkit `o200k_base`)
is directly reusable for deterministic history trimming. Flyway head in this worktree is confirmed
`V76` (the ticket's own "main is at V59" note is stale — verified fresh, not trusted). `V75__metrics.sql`
is the current direct-owner RLS pattern: `owner_id UUID NOT NULL REFERENCES users(id)`, `ENABLE`/
`FORCE ROW LEVEL SECURITY`, one `USING (owner_id = current_setting('app.current_user_id')::uuid)`
policy. `MetricRepository` is the matching Slick DAO shape (`withUserContext`, JSONB column mapping).
`AuthoringChatDrawer`/`useDashboardAuthoringStream` (HEL-395) already exist for the single-shot flow.

## Goals / Non-Goals

**Goals:**
- Multi-turn refinement of the same proposal, server-persisted, RLS-scoped, additive to the existing
  single-shot contract.
- Deterministic, cheap history bounding — no new Claude call just to manage context size.

**Non-Goals:**
- Mid-conversation proposal editing — the existing `ProposalReview` UI already supports editing, once,
  after "review & apply"; this ticket doesn't add a second editing surface.
- Refining already-applied resources (HEL-343).
- Redux for thread state — mirrors HEL-395 D1: view-local, transient UI state.

## Decisions

**D1 — `conversationId` is the only new request field; `goal` is reused as "this turn's message."**
Backward compat requires the existing single-shot contract untouched; adding one new optional field
(`conversationId: Option[String]`) rather than a parallel `message`/`history[]`/`workingProposal`
surface (the ticket's own illustrative sketch) is simpler, harder to get RLS-wrong (the client can
never forge someone else's history since it never transmits history at all — the server is sole
source of truth), and avoids two fields meaning almost the same thing. `goal`'s existing semantics
("the thing to author/refine towards") already cover "this turn's message" once `conversationId` is
present — no rename needed.

**D2 — History and the working proposal are entirely server-owned; no client-supplied override.**
The client never re-sends prior turns or the current proposal — every `author`/`authorStreaming` call
with a `conversationId` loads that row (RLS-scoped `withUserContext`), the server appends the new
turn, and persists the result. This satisfies the AC ("revised, re-validated proposal each turn")
without a second editing surface (Non-Goals) — mid-conversation edits were never in scope, so there's
nothing for the client to need to send back.

**D3 — `authoring_conversations`: JSONB `api_history` + `display_turns` + `latest_proposal`, not a
normalized per-turn table.** Turns are always read/written as a whole per conversation (no per-turn
query need) — mirrors `metrics.allowed_dimensions`/`format`'s "embed structured data as JSONB" choice
over a needless join. Two separate JSONB turn representations, not one (see D7 for why): `api_history`
(`Vector[ClaudeMessage]`, the raw shape needed to continue the Claude conversation — turn 1's user
message carries the full grounded prompt, later turns' user messages are the plain follow-up text
only, mirroring the existing repair-loop's own "don't re-embed grounding" pattern) and `display_turns`
(`Vector[{role, text}]`, human-readable — never raw model JSON). Columns: `id TEXT PK`,
`owner_id UUID NOT NULL REFERENCES users(id)`, `api_history JSONB NOT NULL`,
`display_turns JSONB NOT NULL`, `latest_proposal JSONB`, `total_tokens_used INTEGER NOT NULL DEFAULT 0`
(D5), `created_at`/`updated_at TIMESTAMPTZ`. `V77__authoring_conversations.sql` mirrors `V75`'s RLS
block exactly (`ENABLE`/`FORCE ROW LEVEL SECURITY`, one owner policy).

**D4 — History trimming is deterministic truncation (oldest-first), not summarization.** Before every
Claude call, `AuthoringHistoryBudget.trim(turns, maxTokens)` drops the oldest turn-pairs (never a
half-pair) via `ClaudeTokenEstimator.estimate` until under `DefaultMaxHistoryTokens` (self-approved:
20,000 — well under `ClaudeConfig`'s default `maxInputTokens` of 100,000, leaving headroom for
grounding context + the new message). Alternative considered: LLM-generated summarization of older
turns — rejected as costed and nondeterministic, and the AC's own wording ("bounded... deterministically")
already rules it out.

**D5 — A new per-conversation token ceiling, separate from `ClaudeClient`'s per-request guardrail.**
`total_tokens_used` accumulates `ClaudeResponse.usage.inputTokens + outputTokens` after every
successful turn (real usage, never the estimate — same "estimate drives pre-flight rejection, real
`usage` drives everything else" split HEL-390 already established). A turn that would start on an
already-exhausted conversation (`total_tokens_used >= DefaultMaxConversationTokens`, self-approved:
200,000) returns `422` before any Claude call, with a message suggesting a new conversation.

**D6 — Frontend: extend the existing drawer's local state, not a new Redux slice; the terminal
auto-navigate-and-close effect becomes a manual "Review & apply" control.** Mirrors HEL-395 D1's own
reasoning (view-local, transient state, not shared-application state per `CLAUDE.md`'s Redux
guidance). The *shipped* `AuthoringChatDrawer`'s terminal `useEffect` on `result` unconditionally
navigates and closes the drawer the instant any turn's result arrives — correct for single-shot, but
it must change: on a turn's result, the drawer now appends a `display_turns` entry (D3) and re-opens
the input for a follow-up, instead of navigating away. Navigation to `/proposals/review` only happens
from an explicit "Review & apply" button, reachable after any completed turn. A turn's thread entry
renders the user's own typed text (verbatim — turns 2+ never carry the heavy grounded-prompt text, D3)
for a user turn, and a short deterministic summary (`"Proposed \"<dashboardName>\" (<n> panel(s))"`,
never raw model JSON — consistent with `useDashboardAuthoringStream`'s existing "don't render
`progressText` verbatim" doc comment) for an assistant turn. `ProposalReview`'s existing edit
capability is untouched and remains the only proposal-editing surface.

**D7 — A conversation survives a page reload via a new `GET` hydration route + `sessionStorage`,
not via re-sending history.** The ticket's AC explicitly requires "survive a reload," which D1/D2's
server-owned state alone doesn't deliver on its own (nothing tells a reloaded page which
`conversationId` to resume, and the `POST` response never returns turn history to rehydrate a
thread). Fix: `GET /api/authoring/conversations/:id` (RLS-scoped, `404` for missing/not-owned — same
treatment as a `POST` with an invalid `conversationId`) returns `{ conversationId, displayTurns,
latestProposal }` — never `apiHistory`, which stays server-internal only. The drawer persists
`conversationId` to `sessionStorage` on every successful turn, and on open, checks for a stored id: if
present, fetches and rehydrates the thread; on `404`/failure, clears the stale id and starts fresh
(graceful degradation, mirrors HEL-390 D6's "missing-dependency degrades cleanly" precedent). The
stored id is cleared once "Review & apply" navigates away (the conversation's natural endpoint).

## Risks / Trade-offs

[D2's server-owned history means a conversation lost server-side (e.g. accidental delete) has no
client-side recovery] → acceptable: conversations are ephemeral pre-apply working state, not the
applied dashboard itself; losing one just means starting over, same as today's single-shot UX.

[D4's oldest-first trim could drop context the model still needed] → the trimmed turns were already
superseded by the newer conversation state (the working proposal reflects them); the AC only asks for
deterministic bounding, not perfect context retention across an arbitrarily long thread.

[D5's ceiling could interrupt a legitimate long refinement session] → 200,000 tokens is a high bar
(∼dozens of turns at typical proposal sizes); the error message names the escape hatch (new
conversation) rather than silently truncating or degrading.

[D7's `sessionStorage` is tab-scoped, not cross-device/cross-browser] → acceptable: "survive a
reload" (the AC's literal wording) is satisfied; a genuinely cross-device resumable session is a
larger feature this ticket never claimed, and `sessionStorage` (vs. `localStorage`) deliberately
avoids a stale conversation id lingering indefinitely across unrelated future tabs.

## Migration Plan

Additive only: new table, new optional request/response fields, no changes to any existing table or
to single-shot behavior when `conversationId` is absent. `V77` runs once, standard Flyway apply-on-boot
(no manual step, no backfill — the table starts empty).

## Planner Notes

Self-approved: request/response shape (D1/D2, a deliberate divergence from the ticket's own
illustrative field sketch, with rationale), storage shape (D3), trim/ceiling values (D4/D5), no-Redux
plus the reworked terminal effect (D6), and the reload-hydration route (D7, added after design-gate
review caught that D1/D2 alone silently dropped AC2's "survive a reload") — all conventional
extensions of established patterns, no new external dependency, no breaking change to any endpoint.

## Open Questions

None outstanding.
