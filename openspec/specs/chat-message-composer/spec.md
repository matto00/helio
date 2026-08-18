# chat-message-composer Specification

## Purpose
A real text-input-and-send composer for HEL-659's chat surface, available identically from both the
`/chat` nav page and the quick-launcher overlay via the shared `ActiveConversationPanel`, so a user
can actually converse with the assistant rather than only viewing an already-populated transcript.
## Requirements
### Requirement: A message composer is available wherever the active conversation panel renders
`ActiveConversationPanel` SHALL render a text input and send action, so a composer is available
identically from both the `/chat` nav page and the quick-launcher overlay, without either entry
point implementing its own separate composer.

#### Scenario: The composer is present on /chat
- **WHEN** the user is on `/chat` with a conversation active
- **THEN** a text input and send action are visible

#### Scenario: The composer is present in the quick-launcher overlay
- **WHEN** the user opens the quick-launcher overlay
- **THEN** the same text input and send action are visible, not a second, different composer

### Requirement: Sending a message renders the new turns using existing message-rendering components
A newly-sent message and its response SHALL render via the same `MessageTurn`/`ToolCallIndicator`/
`ProposalHandoff` components already used for previously-persisted turns — no separate rendering
path for composer-originated turns.

#### Scenario: A newly sent message renders identically to a pre-existing turn
- **WHEN** a message is sent and the response returns
- **THEN** both the new user turn and the new assistant turn render using the same components and
  visual treatment as turns that were already in the transcript before the send

### Requirement: A user with no existing conversations can start one by typing
The composer SHALL be usable when no conversation is currently selected (e.g. a user with zero
conversations) — sending in this state creates a new conversation and sends the typed message to
it in one action, not a separate, unreachable "create conversation" step.

#### Scenario: Sending with no conversation selected creates one and sends the message
- **WHEN** a user with no existing conversations types a message and sends it
- **THEN** a new conversation is created, the message is sent to it, and the conversation becomes
  the active selection showing the sent message and its response

### Requirement: Switching conversations clears the composer's draft and pending-send state
`MessageComposer` SHALL clear its typed draft, error message, and pending-send idempotency state
when `conversationId` changes to a different, non-self-created conversation, so a draft typed in
one conversation never appears as leftover state in another conversation opened afterward.

This clearing SHALL be skipped for the one self-created transition: when the composer itself
creates a new conversation from the no-conversation-selected state as part of an in-progress send,
and `conversationId` then flips from `null` to that new conversation's id, the in-flight send's
`message`, pending-send, and sending-indicator state SHALL be preserved unchanged.

#### Scenario: A draft is cleared when switching to a different existing conversation
- **WHEN** a user has typed a draft message in conversation A and switches to conversation B
- **THEN** the composer shows an empty draft, not the text typed for conversation A

#### Scenario: A failed send's retry key is cleared when switching away before retrying
- **WHEN** a send to conversation A fails, leaving a preserved draft and pending-send key, and the
  user switches to conversation B before retrying
- **THEN** the composer's draft and pending-send state are cleared for conversation B; a later
  send from conversation B mints a fresh idempotency key, never A's preserved one

#### Scenario: Creating a conversation from the composer does not clear its own in-flight send
- **WHEN** a user with no conversation selected types a message and sends it, causing the composer
  to create a new conversation and the `conversationId` prop to flip from `null` to that new id
  while the send is still in flight
- **THEN** the composer continues showing its sending indicator and preserves its draft/pending-
  send state for that in-flight send, exactly as before this change

