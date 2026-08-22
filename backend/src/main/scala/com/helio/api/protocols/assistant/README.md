# Protocols — Assistant

Assistant conversation request/response types, and the workspace-assistant tool-call schemas (`AssistantProposalToolSchemas`) offered to Claude's function-calling loop.

Holds: `AssistantConversationProtocol`, `AssistantProposalToolSchemas`, `AssistantProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/assistant/`.
