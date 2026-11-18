## ADDED Requirements

### Requirement: One shared model catalog holds the allow-list and per-model request rules
The backend SHALL hold a single model catalog that lists every selectable Claude model id, its display label, its
request rules and its beta cost weight. The selectable set SHALL be exactly `claude-haiku-5-5`, `claude-sonnet-5-5`
and `claude-opus-5-5` unless configuration narrows it. Configuration SHALL NOT add an id the catalog does not define.
Every surface that lets a caller choose a model (assistant chat now, insight Outputs later) SHALL validate against
this catalog. For every catalog model the client SHALL NOT send `temperature`, `top_p` or `top_k`, SHALL NOT send
`thinking.type = "enabled"` or `budget_tokens`, and SHALL NOT send a forced `tool_choice` (`any` or `tool`).

#### Scenario: Catalog model request omits sampling and thinking budget
- **WHEN** any client call targets a catalog model, including a caller that passes an explicit temperature
- **THEN** the outbound request has no `temperature`, `top_p`, `top_k` or `budget_tokens` field

#### Scenario: Configuration narrows but never widens the selectable set
- **WHEN** the selectable-set configuration names an id the catalog does not define
- **THEN** that id is ignored with a warning and is not selectable

### Requirement: A client-supplied model id is validated against the allow-list
The converse request and the conversation update request SHALL accept an optional `model`. A value outside the
selectable set SHALL be rejected with `400` before any model call, counter charge or persistence. The server SHALL
never forward a client-supplied string to the Claude API; only a catalog entry's own id is sent.

#### Scenario: Unknown model id is rejected
- **WHEN** a caller sends converse or updates a conversation with `model = "claude-fable-5-2"`
- **THEN** the response is `400`, no model call is made, the daily counter is unchanged and nothing is persisted

### Requirement: A conversation keeps its model and a new conversation starts on the user's default
Each conversation SHALL store its model. A new conversation SHALL start on the user's default model when one is set,
otherwise on the server default (`CLAUDE_MODEL`). Changing the model SHALL apply from the next turn on. A converse
request carrying `model` SHALL use it for that turn and store it on the conversation.

#### Scenario: Picked model persists across turns
- **WHEN** the owner sets a conversation's model to `claude-opus-5-5` and sends two messages
- **THEN** both turns are sent with `model = "claude-opus-5-5"`, and the conversation still reports that model

#### Scenario: New conversation uses the user's default
- **WHEN** a user whose default model is `claude-sonnet-5-5` creates a conversation
- **THEN** the conversation's model is `claude-sonnet-5-5`

### Requirement: Every assistant turn records the model that answered it
Each persisted assistant turn SHALL record the model id that answered it, taken from the API response. The transcript
UI SHALL show it subtly per answer.

#### Scenario: Turns from two models are distinguishable
- **WHEN** a conversation answers one turn on Haiku 5.5 and the next on Opus 5.5
- **THEN** the persisted assistant turns record `claude-haiku-5-5` and `claude-opus-5-5` respectively

### Requirement: Switching models never sends another model's thinking block
A request SHALL never contain a `thinking` or `redacted_thinking` block produced by a different model. Within one
turn's tool loop the model SHALL be fixed. Thinking blocks SHALL stay dropped from persisted history.

#### Scenario: Haiku to Opus and Opus to Haiku with tool use and thinking
- **WHEN** turn 1 runs on one model with thinking and tool use, and turn 2 runs on the other model
- **THEN** turn 2's requests carry only the new model's id and no thinking block from turn 1, and no API `400` results

### Requirement: Users set a default model in Settings
Owner and beta users SHALL be able to set and clear a default assistant model in Settings. The preference SHALL accept
only a selectable id or `null`; any other value SHALL be `400`. A stored default that is no longer selectable SHALL be
treated as unset.

#### Scenario: Default model saved and cleared
- **WHEN** a user saves `claude-haiku-5-5` as default and later clears it
- **THEN** new conversations start on Haiku 5.5, and after clearing they start on the server default

### Requirement: The composer shows and changes the conversation's model
Conversation responses SHALL carry the stored `model` (nullable) and the server-resolved `effectiveModel`: the stored
model if still selectable, else the user's default if still selectable, else the server default. A converse without
`model` SHALL use `effectiveModel`. The assistant composer SHALL show `effectiveModel` and let an owner or beta user
change it; a non-selectable `effectiveModel` SHALL be shown as "Server default (<id>)".

#### Scenario: Pick before the first message
- **WHEN** a user with no conversation open picks Opus 5.5 in the composer and sends the first message
- **THEN** the new conversation's first turn is sent with `model = "claude-opus-5-5"` and the conversation keeps it

#### Scenario: Stored model no longer selectable falls through
- **WHEN** a conversation's stored model is removed from the selectable set and the user has no default
- **THEN** its `effectiveModel` is the server default, and the next send uses it

#### Scenario: Changing the model in the composer
- **WHEN** the user picks Sonnet 5.5 in the composer
- **THEN** the conversation's model is saved as `claude-sonnet-5-5` and the next send uses it
