# HEL-665 (reopened): Chat message composer — the missing half of the visual design pass

## Description

HEL-665 ("New chat surface visual design") was delivered and merged via PR #343, but its own scope
text explicitly promised "Design the message list/composer UI for the new chat surface" — the
composer half was never built. Confirmed after merge, by the coordinator, live: no text input, no
send button, on either entry point (`/chat` or the quick-launcher overlay), even for a brand-new
empty conversation. `ActiveConversationPanel.tsx` only ever renders an existing transcript; nothing
in the shipped code has a path to submit a new message. The ticket is reopened to deliver this
missing piece as new work on a fresh worktree/branch, not as a separately-filed ticket.

## Scope (as directed)

* A real message composer (text input + send) wired to actually call `AssistantService.converse`
  (HEL-662, merged, never wired to any live route before this) and persist/append the new turn(s)
  to the conversation's transcript (HEL-663's `AssistantConversationService`).
* Available from both the `/chat` page and the quick-launcher overlay, via the same
  `ActiveConversationPanel` component both entry points already share — the identical "one coherent
  visual system" principle the rest of HEL-665 already established.
* Full Planning → Execution/Evaluation → Delivery cycle, including live verification that a real
  typed message actually round-trips through the real backend (real Claude API, confirmed reachable
  in this dev environment at planning time) and renders.

## Acceptance Criteria

- [ ] A user can type a message into the composer (from either `/chat` or the quick-launcher
      overlay) and send it.
- [ ] Sending a message calls a real backend endpoint that invokes `AssistantService.converse` and
      persists the resulting turns (the user's message, any tool_use/tool_result blocks, Claude's
      final response) into the conversation's transcript via `AssistantConversationService`.
- [ ] The newly-sent message and Claude's response render in the transcript using the existing
      message-rendering components (`MessageTurn`, `ToolCallIndicator`, `ProposalHandoff`) HEL-665
      already shipped — no new rendering path invented for composer-originated turns vs.
      already-persisted ones.
- [ ] A user with no existing conversations can start one by typing directly (not blocked behind a
      separate "create conversation" step with no way to reach it from the empty state).
- [ ] Live-verified: a real typed message actually reaches the real `AssistantService.converse` →
      real `ClaudeClient` → real Anthropic API round trip and the response renders correctly (not
      just a mocked/stubbed test).

## Context / Notes

- This is the same Linear issue as the original HEL-665 (not a new ticket, per the coordinator's
  explicit direction) — reopened, moved back to `In Progress`, delivered as new work on a fresh
  worktree/branch off current `main` (which already has PR #343 merged).
- **This necessarily wires `AssistantService.converse` to a live route for the first time** — every
  prior ticket in this epic (HEL-662, 663, 664, 665's first pass) explicitly deferred this exact
  piece of work ("no live route exists yet"). Confirmed at planning time: `AssistantService`'s 7
  constructor dependencies are 5 already-live `ApiRoutes.scala` vals, `WorkspaceSearchService` (not
  yet constructed anywhere), and `ClaudeClient` (constructed fresh, mirroring
  `DashboardAuthoringService`/`RefinementService`'s own pattern of not sharing a client instance).
- **A real, load-bearing correction is required upstream of the route itself**:
  `AssistantTurnResult` (HEL-662) currently discards the full updated message history
  (`ClaudeToolOutcome.FinalResponse`/`HopBudgetExhausted`'s own `history: Seq[ClaudeToolMessage]`
  field) after using it only to compute `toolCallCount` — there is currently no way for a caller to
  get back the turns needed to persist a conversation continuation. This must be fixed (additive
  field, not a breaking change) before the new route can do anything useful.
- Confirmed at planning time: this dev environment's `backend/.env` has a real, non-blank
  `ANTHROPIC_API_KEY` that reaches `ClaudeConfig.fromEnv()` via `loadDotEnv`, so AC5's live
  round-trip is genuinely testable against the real Anthropic API, not just a fake-transport test.
