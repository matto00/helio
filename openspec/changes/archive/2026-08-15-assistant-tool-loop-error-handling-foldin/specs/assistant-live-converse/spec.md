## ADDED Requirements

### Requirement: The converse response surfaces hop-cap and no-results turn outcomes
`AssistantConversationResponse` SHALL carry two additional optional fields, `hopBudgetExhausted:
Option[Boolean]` and `searchedWithNoResults: Option[Boolean]`, populated from
`AssistantTurnResult`'s identically-named fields only on a `POST /:id/converse` response. `GET
/:id` SHALL leave both fields absent (`None`) — these are ephemeral signals describing the turn
that just completed, not persisted facts about the conversation as a whole.

#### Scenario: A hop-cap-exhausted converse call surfaces the signal
- **WHEN** `AssistantService.converse` resolves to a `Right(result)` with `result.hopBudgetExhausted
  == true`
- **THEN** the `POST /:id/converse` response's `hopBudgetExhausted` field is `Some(true)`

#### Scenario: A zero-result-search converse call surfaces the signal
- **WHEN** `AssistantService.converse` resolves to a `Right(result)` with
  `result.searchedWithNoResults == true`
- **THEN** the `POST /:id/converse` response's `searchedWithNoResults` field is `Some(true)`

#### Scenario: GET never carries either signal
- **WHEN** a client calls `GET /:id` for any conversation, regardless of its transcript's content
- **THEN** the response's `hopBudgetExhausted` and `searchedWithNoResults` fields are both absent
