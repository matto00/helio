# Protocols — Patchsets

Applying a validated edit to an existing artifact: the PatchSet/Edit wire shapes, apply/preview/undo responses, and Refinement (produces a PatchSet — design.md D2).

Holds: `PatchSetApplyProtocol`, `PatchSetPreviewProtocol`, `PatchSetProtocol`, `PatchSetUndoProtocol`, `RefinementProtocol`.

Does NOT hold: protocol types for other domains, or business logic — every
type here is a case class / spray-json `RootJsonFormat` (or a trait
composing them); actual validation and orchestration live in
`services/patchsets/`.
