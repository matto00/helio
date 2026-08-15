## ADDED Requirements

### Requirement: converse's result exposes the full turn history for persistence
`AssistantTurnResult` SHALL carry the complete updated message history (`fullHistory:
Seq[ClaudeToolMessage]`) a `converse` call produced — the caller-supplied history plus every new
turn (the user's message, any `tool_use`/`tool_result` blocks, Claude's final response) — so a
caller can persist the conversation's continuation without re-deriving it.

#### Scenario: fullHistory includes the new user turn and Claude's final response
- **WHEN** `converse` resolves to `ClaudeToolOutcome.FinalResponse`
- **THEN** `AssistantTurnResult.fullHistory` includes the original history, the new user message
  turn, and Claude's final response turn, in order

#### Scenario: fullHistory is populated even when the hop budget is exhausted
- **WHEN** `converse` resolves to `ClaudeToolOutcome.HopBudgetExhausted`
- **THEN** `AssistantTurnResult.fullHistory` still reflects every turn produced up to that point,
  not an empty or partial sequence

### Requirement: converse surfaces a real Claude/transport failure as an error, never a fabricated result
`AssistantService.converse` SHALL return `Left(ClaudeError)` when the underlying call resolves to
`ClaudeToolOutcome.Failed`, never a value-less or fabricated `AssistantTurnResult` for that case.

#### Scenario: A real API failure is represented as an error, not silently absorbed
- **WHEN** `converse` resolves to `ClaudeToolOutcome.Failed`
- **THEN** `converse`'s result is `Left` carrying the underlying `ClaudeError`, not a `Right`
  containing an empty or synthesized `AssistantTurnResult`
