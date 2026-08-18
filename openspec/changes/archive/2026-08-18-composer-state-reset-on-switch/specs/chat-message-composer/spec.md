## ADDED Requirements

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
