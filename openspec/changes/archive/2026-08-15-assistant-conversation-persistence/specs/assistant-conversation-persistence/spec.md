## ADDED Requirements

### Requirement: A conversation can be created, appended to, listed, and pinned via the API
The system SHALL expose `POST /api/assistant-conversations` (create), `POST
/api/assistant-conversations/:id/messages` (append a turn), `GET /api/assistant-conversations`
(list), and `PATCH /api/assistant-conversations/:id` (pin/unpin, rename), each requiring
authentication and operating only on the caller's own conversations.

#### Scenario: A conversation is created, appended to, and later listed
- **WHEN** an authenticated user creates a conversation, appends a turn to it, and then lists their
  conversations
- **THEN** the created conversation appears in the list with an `updatedAt` reflecting the append

#### Scenario: Pinning a conversation is reflected in a subsequent list call
- **WHEN** an authenticated user pins one of their conversations via `PATCH`
- **THEN** a subsequent `GET /api/assistant-conversations` call reflects `pinned: true` for that
  conversation

### Requirement: The list endpoint orders pinned conversations first, then by recency
`GET /api/assistant-conversations` SHALL order results by `pinned DESC, updatedAt DESC`, and SHALL
default to at most the 10 most recent (pinned-first) conversations when no explicit `limit` is
requested — a route-local default distinct from this codebase's shared `Page.Default` (200), which
would silently violate this requirement if reused unmodified.

#### Scenario: A pinned older conversation sorts before an unpinned newer one
- **WHEN** a user has one pinned conversation last updated before an unpinned conversation updated
  more recently
- **THEN** the pinned conversation appears first in the list

#### Scenario: The default list is capped at 10 without an explicit page size
- **WHEN** a user with more than 10 conversations calls `GET /api/assistant-conversations` with no
  page-size parameter
- **THEN** at most 10 conversations are returned, pinned-first then most-recent-first

### Requirement: The transcript body round-trips through the existing uploads-backend abstraction
The transcript body (the conversation's `Seq[ClaudeToolMessage]`) SHALL be stored and retrieved via
the existing `FileSystem` abstraction (the same one `HELIO_UPLOADS_BACKEND`/`HELIO_UPLOADS_BUCKET`
already select between local and GCS for other features), under the path prefix
`assistant-conversations/{userId}/{conversationId}.json`, with no new bucket/IAM wiring or parallel
storage implementation.

#### Scenario: A round-tripped transcript matches what was written
- **WHEN** a conversation's transcript is written via `FileSystem.write` and then read back via
  `FileSystem.read` and deserialized
- **THEN** the deserialized `Seq[ClaudeToolMessage]` equals what was originally written

### Requirement: RLS prevents one user from listing or reading another user's conversations
`assistant_conversations` SHALL enforce row-level security (`FORCE ROW LEVEL SECURITY`, an
owner-id policy keyed off the request's session-scoped user id) such that a query run under a real,
non-superuser database role for one user never returns another user's conversation rows, whether by
list or by direct id lookup.

#### Scenario: A second user cannot list the first user's conversations
- **WHEN** user B, authenticated as a real non-superuser database role (not the RLS-bypassing
  privileged pool), calls `GET /api/assistant-conversations` after user A has created conversations
- **THEN** user B's result does not include any of user A's conversations

#### Scenario: A second user cannot fetch the first user's conversation by id
- **WHEN** user B, authenticated as a real non-superuser database role, requests user A's
  conversation by its id
- **THEN** the result is a not-found response, not the conversation's content
