# Protocols — Workspace

Workspace-wide NL search/get_resource and context-budget wire shapes.

Holds: `WorkspaceContextProtocol`, `WorkspaceProtocol`, `WorkspaceResourceSearchProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/workspace/`.
