# Routes — Panels

Panel, auto-layout and bound-panel HTTP routes.

Holds: `AutoLayoutRoutes`, `BoundPanelRoutes`, `PanelRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/panels/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
