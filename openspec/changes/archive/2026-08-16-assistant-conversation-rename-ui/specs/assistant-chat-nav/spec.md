# assistant-chat-nav — delta for assistant-conversation-rename-ui (HEL-693)

## ADDED Requirements

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
