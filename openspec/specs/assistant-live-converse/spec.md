# assistant-live-converse Specification

## Purpose
The live backend endpoint that actually invokes `AssistantService.converse` and persists the
resulting turns via `AssistantConversationService` — the first real wiring of the assistant's
conversational loop to a route a user can reach, degrading cleanly to `503` when the assistant
itself is unavailable and never persisting anything on a failed Claude/transport call.
## Requirements
### Requirement: A live endpoint sends a message and persists the resulting turns
The system SHALL expose `POST /api/assistant-conversations/:id/converse`, accepting `{message:
string}`, that calls `AssistantService.converse` against the conversation's existing transcript,
persists the resulting new turns via `AssistantConversationService.appendTurn`, and returns the
refreshed conversation detail (including the updated transcript).

#### Scenario: A sent message is persisted and returned in the response
- **WHEN** an authenticated user posts a message to their own conversation's `/converse` endpoint
- **THEN** the response's transcript includes the user's new message and Claude's response, and a
  subsequent `GET` for the same conversation returns the identical, already-persisted transcript

### Requirement: A real Claude/transport failure returns an error and persists nothing
`POST /:id/converse` SHALL return a mapped error status (never a `200`) and SHALL NOT call
`appendTurn` when the underlying `AssistantService.converse` call fails, so a real API failure
never silently discards the user's message nor gets persisted into the transcript as a fabricated
response.

#### Scenario: A failed converse call leaves the transcript unchanged
- **WHEN** `AssistantService.converse` resolves to `Left(ClaudeError)` for a given `/converse`
  request
- **THEN** the response is a non-`200` error status, and a subsequent `GET` for the same
  conversation shows the transcript exactly as it was before the failed request

### Requirement: The endpoint degrades to a clean 503 when the assistant is unavailable
`POST /:id/converse` SHALL respond `503` when `AssistantService` is unavailable (e.g. no
`ANTHROPIC_API_KEY` configured), independent of whether the rest of the `assistant-conversations`
route family (list/create/get/append/pin) is available.

#### Scenario: A missing Claude configuration degrades only the converse route
- **WHEN** `AssistantService` is unavailable but conversation persistence is otherwise configured
- **THEN** `POST /:id/converse` responds `503` while `GET /api/assistant-conversations` continues
  to work normally

### Requirement: Only the conversation's owner can converse with it
`POST /:id/converse` SHALL enforce the same ownership scoping every other
`assistant-conversations` endpoint already enforces — a caller cannot converse with, or persist
turns into, a conversation they do not own.

#### Scenario: A second user cannot converse with the first user's conversation
- **WHEN** a user posts to `/converse` for a conversation id they do not own
- **THEN** the response is a not-found result, not the conversation's content, and no turns are
  persisted

