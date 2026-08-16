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

### Requirement: A conversation can be renamed inline from the conversation list

The chat sidebar's conversation list SHALL provide a per-row rename affordance, rendered alongside the
existing pin/unpin row action, that swaps the row into an inline editable state for the conversation's
title. Committing a rename SHALL persist the new title via `PATCH /api/assistant-conversations/:id`
(`{ title }`) and update both the list item and, when it is the active conversation, the active-conversation
panel heading. A title that is blank after trimming SHALL never be submitted. The affordance SHALL be
keyboard operable: Enter commits, Escape cancels.

#### Scenario: Renaming a conversation from the list

- **WHEN** the user activates a conversation row's rename action, replaces the title text, and presses Enter
- **THEN** the client sends `PATCH /api/assistant-conversations/:id` with `{ title: "<new title>" }`
- **AND** the row shows the new title once the request succeeds
- **AND** if the renamed conversation is the active one, the active-conversation panel heading shows the
  new title

#### Scenario: Escape cancels a rename

- **WHEN** the user activates the rename action, edits the text, and presses Escape
- **THEN** no PATCH request is sent and the row shows the original title

#### Scenario: A blank title is never saved

- **WHEN** the user clears the input (or enters only whitespace) and presses Enter
- **THEN** no PATCH request is sent, the input is marked invalid, and the row remains in the editable state

#### Scenario: An unchanged title is a no-op

- **WHEN** the user commits a title identical (after trimming) to the current one
- **THEN** no PATCH request is sent and the row exits the editable state showing the original title

#### Scenario: A failed rename surfaces a visible error

- **WHEN** the PATCH request fails
- **THEN** the row remains in the editable state and a visible error message (`role="alert"`) is shown
  for the row

#### Scenario: Activating rename does not select the conversation

- **WHEN** the user clicks a row's rename action
- **THEN** the conversation is not selected (the active conversation does not change)

