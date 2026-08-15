## ADDED Requirements

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
