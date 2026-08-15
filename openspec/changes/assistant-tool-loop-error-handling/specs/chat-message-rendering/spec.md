## ADDED Requirements

### Requirement: An unresolved tool call renders a cut-short indicator, not a stuck loading state
A `tool_use` content block with no paired `tool_result` in the persisted transcript SHALL render a
distinct "cut short" treatment, never the same indeterminate/in-progress appearance a genuinely
pending call would use. This is the hop-cap-exhausted case — Claude requested a tool call the loop
never executed.

#### Scenario: A dangling tool_use from a hop-cap-exhausted turn renders as cut short
- **WHEN** a transcript's last turn contains a `tool_use` block with no corresponding `tool_result`
- **THEN** `ToolCallIndicator` renders a "cut short" treatment for that block, distinct from its
  normal in-progress or completed states

### Requirement: A turn signals when the assistant asked a follow-up or hit the hop cap
`MessageTurn`/`ActiveConversationPanel` SHALL render a distinct visual treatment for the most
recently completed assistant turn when the converse response's `hopBudgetExhausted` or
`searchedWithNoResults` field is `Some(true)` — driven by that explicit signal, never inferred by
matching the turn's text content.

#### Scenario: A hop-cap-exhausted turn renders with a distinct treatment
- **WHEN** a converse response's `hopBudgetExhausted` field is `Some(true)`
- **THEN** the resulting assistant turn renders with a visually distinct "couldn't finish in time"
  treatment, not the same styling as a normal completed answer

#### Scenario: A no-results turn renders with a distinct treatment
- **WHEN** a converse response's `searchedWithNoResults` field is `Some(true)`
- **THEN** the resulting assistant turn renders with a visually distinct "asking a follow-up"
  treatment, not the same styling as a normal completed answer

#### Scenario: A normal completed turn is unaffected
- **WHEN** a converse response has both `hopBudgetExhausted` and `searchedWithNoResults` absent or
  `Some(false)`
- **THEN** the resulting assistant turn renders with its existing, undecorated treatment
