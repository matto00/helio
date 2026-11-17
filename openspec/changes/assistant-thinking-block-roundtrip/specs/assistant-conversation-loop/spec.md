## ADDED Requirements

### Requirement: The persisted conversation never carries model-internal blocks or empty text
The turns `converse` returns for persistence SHALL contain no thinking, redacted-thinking or unrecognised blocks and
no empty text blocks, and SHALL keep exactly one returned turn per turn of the full history, so the caller's
slicing by prior history length is unchanged. The conversation view SHALL render no message bubble for an empty or
whitespace-only text block, including in conversations saved before this rule.

#### Scenario: Two-turn conversation on a thinking model
- **WHEN** turn 1's response is a thinking block (empty `thinking`, a signature) then text, and the user sends a
  second message
- **THEN** the persisted assistant turn holds only the text block
- **AND** the second turn's request contains no thinking block from turn 1 and no empty text block

#### Scenario: Legacy empty bubble
- **WHEN** a saved transcript holds an assistant text block with empty text
- **THEN** the conversation view shows no bubble for it

### Requirement: A no-answer turn surfaces as an error and persists nothing
When the tool-use loop ends with a no-answer failure, or ends with a final response (not a hop-budget stop) that
has no visible answer text while no proposal was captured in that turn, `converse` SHALL fail with an
error message naming the cause. A refusal SHALL say Claude declined the request and name the category or
"unspecified". Any other no-answer SHALL name the stop reason. No turn SHALL be persisted.

#### Scenario: Refusal on the assistant route
- **WHEN** the model refuses a converse message
- **THEN** the route responds with an error whose message says Claude declined the request
- **AND** the conversation transcript is unchanged

#### Scenario: Proposal then an empty end_turn
- **WHEN** a turn calls a propose tool that validates and the next hop ends the turn with empty content
- **THEN** the turn succeeds, the persisted transcript holds the proposal's tool_use and tool_result
- **AND** the next converse request contains no empty message

### Requirement: Every converse request ends with a user turn
Every request `converse` sends SHALL end with a user message, so no request is an assistant prefill.

#### Scenario: Continued conversation with a dangling tool_use
- **WHEN** the persisted history ends with an assistant turn holding an unexecuted `tool_use`
- **THEN** the request's last message has role `user`
