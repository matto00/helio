## ADDED Requirements

### Requirement: A conversation SHALL persist server-side, owner-scoped, and be resumable by id
The backend SHALL persist an authoring conversation (turns + the latest working proposal) in a new
`authoring_conversations` table, row-level-security-scoped to the owning user, and SHALL return a
`conversationId` the caller can supply on a subsequent call to continue that same conversation.

#### Scenario: A first turn mints a new, persisted conversation
- **WHEN** `POST /api/authoring/dashboard` is called without a `conversationId`
- **THEN** the response includes a new `conversationId`, and a row owned by the caller exists in
  `authoring_conversations` containing that turn

#### Scenario: A second turn with the same conversationId continues it
- **WHEN** `POST /api/authoring/dashboard` is called with a `conversationId` from a prior successful
  call, and a new goal/message
- **THEN** the response's revised proposal reflects both turns (e.g. a follow-up instruction
  modifies the panel the first turn proposed), and the persisted row's turn count increases by one

#### Scenario: A conversationId owned by another user is rejected
- **WHEN** `POST /api/authoring/dashboard` is called with a `conversationId` that exists but is
  owned by a different user
- **THEN** the call is rejected (not found, per RLS) rather than exposing or continuing that
  conversation

### Requirement: Every turn SHALL be re-validated via the shared apply-path checks
A revised proposal from a continued conversation SHALL be validated via
`DashboardProposalService.validate` — the same checks the single-shot path and the apply path use —
before being returned or persisted.

#### Scenario: A structurally invalid revision is repaired or rejected, never persisted as-is
- **WHEN** a continued-conversation turn's model output fails `DashboardProposalService.validate`
- **THEN** the same bounded repair behavior the single-shot path already has applies (one re-prompt,
  then a `422` on a second failure) — an invalid proposal is never persisted as the conversation's
  latest working proposal

### Requirement: Retained history SHALL be bounded deterministically, never via summarization
Before each Claude call on a continued conversation, the backend SHALL trim retained history to a
configured token budget by dropping the oldest turns first — never by generating an LLM summary.

#### Scenario: A long conversation's oldest turns are dropped, not summarized
- **WHEN** a conversation's persisted turn history exceeds the configured history token budget
- **THEN** the oldest turns are excluded from the next Claude call until the remaining history fits
  the budget, and no additional Claude call is made to produce a summary

### Requirement: A per-conversation token ceiling SHALL reject further turns once exhausted
The backend SHALL track accumulated real token usage (from `ClaudeResponse.usage`, never an estimate)
per conversation and SHALL reject a further turn with `422` once that conversation's ceiling is
reached, before making any Claude call for that turn.

#### Scenario: An exhausted conversation rejects its next turn before any Claude call
- **WHEN** a conversation's accumulated token usage is at or above the configured per-conversation
  ceiling and another turn is submitted
- **THEN** the call returns `422` and no Claude call is made for that turn

### Requirement: Single-shot authoring (no conversationId) SHALL remain unchanged
Calling `POST /api/authoring/dashboard` without a `conversationId` SHALL behave exactly as it did
before this change — the additive persistence is transparent to a caller that never supplies or
reuses a `conversationId`.

#### Scenario: A caller that never sends conversationId sees no behavior change
- **WHEN** `POST /api/authoring/dashboard` is called repeatedly, each time without a `conversationId`
- **THEN** each call is treated as an independent single-shot authoring request, exactly as before
  this change, regardless of any conversation rows persisted as a side effect

### Requirement: A conversation SHALL survive a page reload via a hydration route
`GET /api/authoring/conversations/:id` SHALL return the conversation's display-oriented turns and
latest proposal (RLS-scoped, `404` for missing/not-owned), and the chat surface SHALL use it plus a
client-persisted conversation id to rehydrate a visible thread after a reload — not merely persist a
database row with no client-facing way to resume it.

#### Scenario: A reloaded page rehydrates an in-progress conversation
- **WHEN** a user reloads the page after at least one successful turn in a conversation, with that
  conversation's id still available client-side
- **THEN** the chat surface fetches `GET /api/authoring/conversations/:id` and re-renders the visible
  thread from the response, without the user having to restate any prior turn

#### Scenario: A stale or foreign conversation id degrades gracefully
- **WHEN** the client-persisted conversation id no longer resolves (deleted, or not owned by the
  current session)
- **THEN** the chat surface clears the stale id and starts a fresh conversation, rather than erroring

### Requirement: The chat surface SHALL render a multi-turn thread and hand off to the existing review UI on an explicit action
The chat drawer SHALL display the conversation's turns as they occur and SHALL NOT automatically
navigate away on a turn's completion — navigation to the existing Proposal Review UI, with the latest
working proposal, SHALL happen only when the user explicitly activates "review & apply."

#### Scenario: A completed turn keeps the drawer open for a follow-up, not an automatic hand-off
- **WHEN** a turn completes with a valid revised proposal
- **THEN** the chat surface appends that turn to the visible thread and keeps the drawer open with
  the input ready for a follow-up message, rather than automatically navigating to the review route

#### Scenario: A second turn's response is appended to the visible thread
- **WHEN** a user submits a follow-up message in an open conversation
- **THEN** the new turn's streamed response is appended to the visible thread rather than replacing
  it

#### Scenario: Review & apply hands off the latest working proposal unchanged
- **WHEN** the user activates "review & apply" at any point in a multi-turn conversation
- **THEN** the app navigates to `/proposals/review` with `location.state.proposal` set to the most
  recently returned proposal, identical in shape to the single-shot hand-off
