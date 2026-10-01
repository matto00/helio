# Protocols — First run

Request/response protocol types for the zero-to-dashboard first-run build.

Holds: `FirstRunProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); the build itself lives in `services/firstrun/`.
