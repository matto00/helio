# Protocols — Auth

Auth, MFA, API-token, beta-access and permission request/response protocol types.

Holds: `ApiTokenProtocol`, `AuthProtocol`, `BetaAccessProtocol`, `MfaProtocol`, `PermissionProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/auth/`.
