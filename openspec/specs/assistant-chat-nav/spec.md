# assistant-chat-nav Specification

## Purpose
A first-class `/chat` nav destination for HEL-659's top-level assistant: a conversation list
(reusing `SidebarItemList`, pinned-first per the backend's own ordering, pin/unpin, no delete) and
selection wiring that loads the chosen conversation's real transcript into a minimal placeholder
panel — the message-rendering UI itself is a later ticket's job.
## Requirements
### Requirement: /chat route is registered and reachable from the desktop nav
The frontend SHALL register a `/chat` route via React Router that renders `ChatPage`, and
`navDestinations.ts` SHALL include a Chat entry so the desktop sidebar shows a `NavLink` to `/chat`.

#### Scenario: Navigating to /chat renders ChatPage
- **WHEN** the user navigates to `/chat`
- **THEN** `ChatPage` is rendered

#### Scenario: The desktop sidebar includes a Chat nav link
- **WHEN** the app shell renders at a desktop viewport
- **THEN** a `NavLink` to `/chat` labeled "Chat" is visible within the main navigation

### Requirement: The conversation list shows the API's own pinned-then-recent ordering
`ChatPage`'s sidebar list SHALL render the conversations returned by `GET
/api/assistant-conversations` in the order the API returns them (pinned-first, then most-recent),
without a separate client-side re-sort, and SHALL visually distinguish pinned conversations.

#### Scenario: Pinned conversations render before unpinned ones, matching API order
- **WHEN** the conversation list loads a response where a pinned conversation is not first in
  `updatedAt` order
- **THEN** the list still renders in the exact order the API returned (pinned conversation first)

#### Scenario: A pinned conversation is visually marked
- **WHEN** a conversation in the list has `pinned: true`
- **THEN** it renders with a visible pin indicator distinguishing it from unpinned conversations

### Requirement: Pin and unpin are available from the conversation list
The conversation list SHALL provide a pin/unpin action per conversation that calls `PATCH
/api/assistant-conversations/:id` and updates the list's rendered order/badge on success.

#### Scenario: Pinning a conversation from the list
- **WHEN** the user pins an unpinned conversation from the list
- **THEN** a `PATCH` request is sent with `{pinned: true}`, and the conversation subsequently
  renders with the pinned indicator

### Requirement: No delete affordance is rendered for conversations
The conversation list SHALL NOT render a delete action for conversations, since HEL-663's API has
no delete endpoint.

#### Scenario: The conversation list has no delete option
- **WHEN** a user opens a conversation's row-level actions menu (if rendered at all) in the chat
  section
- **THEN** no delete option is present

### Requirement: Selecting a conversation loads its transcript
Selecting a conversation from the list SHALL fetch that conversation's full detail (including its
transcript) via `GET /api/assistant-conversations/:id` and hold it in state, distinct from the
list's own summary-only data.

#### Scenario: Selecting a conversation fetches and displays its transcript
- **WHEN** the user selects a conversation from the list
- **THEN** a `GET` request for that conversation's id is issued, and once it resolves, the active
  conversation panel reflects that conversation's title and transcript length

#### Scenario: Selecting a different conversation replaces the active one
- **WHEN** the user selects a second conversation while a first conversation's detail is already
  loaded
- **THEN** the active conversation panel updates to reflect the second conversation's data, not a
  stale mix of both

### Requirement: The active conversation panel handles loading, empty, and error states
The active conversation panel SHALL show a loading indicator while fetching a selected
conversation's detail, an `EmptyState` when no conversation is selected (e.g. an empty list), and a
visible, non-swallowed error when the detail fetch fails — per DESIGN.md's UI state requirements.

#### Scenario: No conversations yields an empty state, not a blank panel
- **WHEN** the authenticated user has no conversations
- **THEN** the active conversation panel renders `EmptyState`, not empty/blank content

#### Scenario: A failed detail fetch surfaces a visible error
- **WHEN** fetching a selected conversation's detail fails
- **THEN** the panel shows a visible, human-readable error, not a silent failure

