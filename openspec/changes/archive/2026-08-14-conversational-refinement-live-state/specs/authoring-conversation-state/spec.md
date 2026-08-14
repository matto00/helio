## MODIFIED Requirements

### Requirement: A conversation SHALL persist server-side, owner-scoped, and be resumable by id
The backend SHALL persist a conversation (turns + its latest working outcome) in the
`authoring_conversations` table, row-level-security-scoped to the owning user, and SHALL return a
`conversationId` the caller can supply on a subsequent call to continue that same conversation. A
conversation's latest working outcome SHALL be either a `DashboardProposal` (an authoring
conversation, started via `POST /api/authoring/dashboard`) or a `PatchSet` (a refinement conversation,
started via `POST /api/refinements`) — never both.

#### Scenario: A first turn mints a new, persisted conversation
- **WHEN** `POST /api/authoring/dashboard` or `POST /api/refinements` is called without a
  `conversationId`
- **THEN** the response includes a new `conversationId`, and a row owned by the caller exists in
  `authoring_conversations` containing that turn

#### Scenario: A second turn with the same conversationId continues it
- **WHEN** either endpoint is called with a `conversationId` from a prior successful call on that SAME
  endpoint, and a new goal/message
- **THEN** the response's revised outcome reflects both turns, and the persisted row's turn count
  increases by one

#### Scenario: A conversationId owned by another user is rejected
- **WHEN** either endpoint is called with a `conversationId` that exists but is owned by a different
  user
- **THEN** the call is rejected (not found, per RLS) rather than exposing or continuing that
  conversation

#### Scenario: A conversationId belonging to the OTHER flow is rejected, never silently reassigned
- **WHEN** `POST /api/refinements` is called with a `conversationId` that exists, is owned by the
  caller, but belongs to an authoring conversation (its `latest_patch_set` is `NULL`) — or,
  symmetrically, `POST /api/authoring/dashboard` is called with a refinement conversation's id
- **THEN** the call is rejected the same way a missing conversation would be, and that conversation's
  existing `latest_proposal`/`latest_patch_set` value is left completely unchanged

### Requirement: A conversation SHALL survive a page reload via a hydration route
`GET /api/authoring/conversations/:id` SHALL return the conversation's display-oriented turns and its
latest outcome — a `latestProposal` for an authoring conversation, or a `latestPatchSet` for a
refinement conversation (RLS-scoped, `404` for missing/not-owned) — and the corresponding chat surface
SHALL use it plus a client-persisted conversation id to rehydrate a visible thread after a reload.

#### Scenario: A reloaded page rehydrates an in-progress conversation
- **WHEN** a user reloads the page after at least one successful turn in a conversation, with that
  conversation's id still available client-side
- **THEN** the corresponding chat surface fetches `GET /api/authoring/conversations/:id` and re-renders
  the visible thread from the response, without the user having to restate any prior turn

#### Scenario: A stale or foreign conversation id degrades gracefully
- **WHEN** the client-persisted conversation id no longer resolves (deleted, or not owned by the
  current session)
- **THEN** the chat surface clears the stale id and starts a fresh conversation, rather than erroring

## ADDED Requirements

### Requirement: A conversation's persisted outcome SHALL never populate both columns
The database SHALL reject, via a `CHECK` constraint, any write that would leave both
`latest_proposal`/`latest_patch_set` populated on the same row — never relying on application
discipline alone. `AuthoringConversationRepository.create`/`appendTurn` SHALL populate exactly one of
the two columns for any given write, since a conversation belongs to exactly one flow from its first
turn.

#### Scenario: An authoring conversation never has a patch set
- **WHEN** a conversation was started via `POST /api/authoring/dashboard`
- **THEN** its `latest_patch_set` column is `NULL` after every turn, including turn 1

#### Scenario: A refinement conversation never has a proposal
- **WHEN** a conversation was started via `POST /api/refinements`
- **THEN** its `latest_proposal` column is `NULL` after every turn, including turn 1
