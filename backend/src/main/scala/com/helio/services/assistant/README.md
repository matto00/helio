# Services — Assistant

The top-level workspace assistant conversation loop: tool-call dispatch, system prompt, telemetry.

Holds: `AssistantConversationService`, `AssistantService`, `AssistantSystemPrompt`, `AssistantTelemetry`, `AssistantToolExecutor`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/assistant/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
