# Protocols — Proposals

Generating a NEW artifact: dashboard/pipeline authoring proposal wire shapes, the combined-proposal wrapper, and the shared authoring-conversation view type.

Holds: `AuthoringConversationProtocol`, `CombinedProposalProtocol`, `DashboardAuthoringProtocol`, `DashboardProposalProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/proposals/`.
