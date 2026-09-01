# Protocols — Panels

Panel and panel-capability request/response protocol types. `BoundPanelProtocol`
was deleted in HEL-904 -- the five bound-panel kinds it described collapsed
into the single `output`-kind `Panel`, whose config is `OutputConfig` (see
`PanelProtocol`).

Holds: `PanelCapabilityProtocol`, `PanelProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/panels/`.
