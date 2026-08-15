## ADDED Requirements

### Requirement: converse's result signals when a search found nothing
`AssistantTurnResult` SHALL carry a `searchedWithNoResults: Boolean` field, `true` when the turn's
outcome is `FinalResponse` (no proposal captured) and the last tool call executed in this turn's
new history was a `find` call whose result was an empty array — `false` otherwise, including when
no `find` call was made at all.

#### Scenario: A zero-result find followed by a plain final answer sets the flag
- **WHEN** the scripted executor's `find` call resolves to `Right("[]")` and the transport's next
  response is a final text block with no further tool call
- **THEN** `AssistantTurnResult.searchedWithNoResults` is `true`

#### Scenario: A find call with results does not set the flag
- **WHEN** the scripted executor's `find` call resolves to a non-empty result array and the
  transport's next response is a final text block
- **THEN** `AssistantTurnResult.searchedWithNoResults` is `false`

#### Scenario: A turn with no find call does not set the flag
- **WHEN** a turn's tool calls never include `find` (e.g. only `get_resource`)
- **THEN** `AssistantTurnResult.searchedWithNoResults` is `false`
