# Protocols — Admin

Response protocol types for the owner-only admin endpoints (`GET /api/admin/usage`).

Holds: `AdminUsageProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); the aggregation lives in `services/telemetry/`.
