## MODIFIED Requirements

### Requirement: A turn signals when the assistant asked a follow-up or hit the hop cap
`MessageTurn`/`ActiveConversationPanel` SHALL render a distinct visual treatment for the most
recently completed assistant turn when the converse response's `hopBudgetExhausted` or
`searchedWithNoResults` field is `Some(true)`, or its `stopReason` is `failure_budget` or `input_budget` — driven by
that explicit signal, never inferred by matching the turn's text content.

#### Scenario: A hop-cap-exhausted turn renders with a distinct treatment
- **WHEN** a converse response's `hopBudgetExhausted` field is `Some(true)`
- **THEN** the resulting assistant turn renders with a visually distinct "Couldn't finish in one go"
  treatment, not the same styling as a normal completed answer

#### Scenario: The ceiling fallback bubble shows the server message, never a hop count
- **WHEN** a converse response's `hopBudgetExhausted` is `Some(true)` and the last turn has no text
- **THEN** the fallback bubble renders the response's `stopMessage`, or a generic fallback text when it is absent,
  and no fixed number of lookups or hops is shown anywhere

#### Scenario: A failure-budget stop renders a note
- **WHEN** a converse response's `stopReason` is `failure_budget`
- **THEN** the stop message bubble carries the note "Stopped after repeated errors"

#### Scenario: An input-budget stop renders a note
- **WHEN** a converse response's `stopReason` is `input_budget`
- **THEN** the stop message bubble carries the note "Stopped: conversation too long"

#### Scenario: A no-results turn renders with a distinct treatment
- **WHEN** a converse response's `searchedWithNoResults` field is `Some(true)`
- **THEN** the resulting assistant turn renders with a visually distinct "asking a follow-up"
  treatment, not the same styling as a normal completed answer

#### Scenario: A normal completed turn is unaffected
- **WHEN** a converse response has `hopBudgetExhausted` and `searchedWithNoResults` absent or
  `Some(false)` and no early `stopReason`
- **THEN** the resulting assistant turn renders with its existing, undecorated treatment
