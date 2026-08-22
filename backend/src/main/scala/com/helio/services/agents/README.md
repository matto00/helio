# Services — Agents

Agent memory and preference business logic (HEL-661 find/get_resource substrate).

Holds: `AgentMemoryService`, `AgentPreferencesService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/agents/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
