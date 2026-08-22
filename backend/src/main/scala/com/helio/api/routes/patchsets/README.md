# Routes — Patchsets

Applying a validated edit to an existing artifact: PatchSet apply/undo routes, and Refinement (produces a PatchSet — design.md D2).

Holds: `PatchSetRoutes`, `PatchSetUndoRoutes`, `RefinementRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/patchsets/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
