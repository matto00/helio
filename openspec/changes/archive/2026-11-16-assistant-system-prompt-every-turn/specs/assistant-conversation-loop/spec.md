## ADDED Requirements

### Requirement: The assistant system prompt is sent in the system field on every turn
`AssistantService.converse` SHALL pass `AssistantSystemPrompt.text` as the `ClaudeToolRequest.system` prompt on
every call, whether `history` is empty or not, and SHALL NOT fold it into any message. The history `converse`
returns (and therefore what `AssistantConversationRoutes` persists and the UI renders) SHALL never contain the
system prompt text. A conversation persisted before this change (turn 1 stored as the plain user message) SHALL
receive the system prompt on its next turn with no data migration.

#### Scenario: A turn-2 request carries the system prompt
- **WHEN** `converse` is called once with empty history, and then again with the history the first call returned
- **THEN** the serialized outbound request of the second call has a top-level `system` field whose text equals
  `AssistantSystemPrompt.text`, byte-identical to the first call's `system` field

#### Scenario: No message carries the system prompt
- **WHEN** any `converse` call's outbound request is serialized
- **THEN** no entry of its `messages` array contains `AssistantSystemPrompt.text`

#### Scenario: The persisted transcript never shows the system prompt
- **WHEN** two messages are sent through the conversation converse route and the conversation is read back
- **THEN** no persisted turn contains `AssistantSystemPrompt.text`, and turn 1 is the plain user message

#### Scenario: A legacy conversation gets the system prompt on its next turn
- **WHEN** `converse` is called with a non-empty history whose turn 1 is a plain user message (the shape persisted
  before this change)
- **THEN** the outbound request carries `system` equal to `AssistantSystemPrompt.text`
