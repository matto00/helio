# Protocols — Alerts

Alert rule and alert event request/response protocol types.

Holds: `AlertEventProtocol`, `AlertRuleProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/alerts/`.
