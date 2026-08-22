# Services — Workspace

Cross-domain workspace-wide operations: NL search/get_resource, context-budget building for the assistant, and teardown/cleanup.

Holds: `WorkspaceAssistantTools`, `WorkspaceContextBudget`, `WorkspaceContextService`, `WorkspaceSearchService`, `WorkspaceTeardownService`.

Does NOT hold: business logic for other domains, or persistence
(`infrastructure/persistence/workspace/`) — this directory's files call
repositories, never `db.run` directly (CONTRIBUTING.md). `private[services]`
members here stay reachable from every other domain subpackage (no
encapsulation implied by the split).
