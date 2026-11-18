## Why

The owner wants to compare Haiku 5.5, Sonnet 5.5 and Opus 5.5 from the chat UI instead of redeploying with a new
`CLAUDE_MODEL`. Today one env var picks the model for every assistant turn, and the insight leaves (HEL-1740/1743/1744)
need the same per-request choice, so the allow-list and per-model request rules must live in one shared place.

## What Changes

- A shared backend model catalog (`ClaudeModelCatalog`): the selectable ids, display labels, per-model request rules
  (no sampling parameters, adaptive thinking by default, never `budget_tokens`, never a forced `tool_choice`) and the
  beta cost weight. Env can narrow the selectable set and override weights. The insight leaves will read it.
- `ClaudeClient` accepts a per-request model chosen only from the catalog, applies that model's rules, and reads the
  response's `model` field.
- A conversation stores its model (V140). A new conversation starts on the user's default model, else the server
  default. `PATCH` on a conversation and the converse request both accept an optional `model`; an id outside the
  allow-list is a `400`.
- Every persisted assistant turn records the model that answered it; the transcript shows it subtly.
- A per-user default model in Settings (`users.preferences.assistantModel`, `null` clears).
- A model picker in the assistant composer (the shared `Select`). Responses carry the server-resolved
  `effectiveModel`, so the picker always shows the model the next turn will use.
- The beta daily counter is weighted per model (owner ruling): Haiku 1, Sonnet 4, Opus 8, env-overridable. Owner tier
  stays uncounted.
- `GET /api/assistant-models` returns the selectable models, their weights and the server default.
- `CLAUDE.md` env rows: `CLAUDE_MODEL` becomes the server default, overridable per conversation; new rows for the
  selectable-set and weight variables.

## Capabilities

### New Capabilities
- `assistant-model-selection`: the shared catalog, per-conversation model, per-turn record, user default, picker,
  allow-list validation and per-model request rules.

### Modified Capabilities
- `tier-gated-assistant-access`: the beta daily cap counts a weighted unit per converse send instead of 1.

## Non-goals

- Insight rendering with a chosen model (HEL-1740/1743/1744 consume the catalog).
- Fable or any model outside the three owner-ruled ids.
- A dollar-based budget; changing pipeline AI or authoring/refinement routes off the server default model.
- An MCP converse tool (helio-mcp has none today); the API contract is the JSON schema.

## Impact

Backend: `infrastructure/ai` (catalog, client, wire models), `AssistantService`, `AssistantConversationRoutes`/
service/repository, `ChatAccessService`, `AssistantDailyUsageRepository`, `UserPreferencesRoutes`/repository,
Flyway V140. Frontend: assistant composer, transcript rendering, conversations slice/service, Settings.
Schemas: `converse-request`, `assistant-conversation`, `assistant-conversation-summary`,
`update-assistant-conversation-request`, `auth/user-preferences`, `auth/update-user-preferences-request`, new
`assistant-models-response`. Docs: CLAUDE.md.
