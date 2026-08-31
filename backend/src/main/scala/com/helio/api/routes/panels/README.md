# Routes — Panels

Panel and auto-layout HTTP routes. `BoundPanelRoutes`
(`GET /api/panels/bound`, `GET /api/panels/:id/query`) was deleted in
HEL-904 -- panel-level data binding/aggregation no longer exists; a panel's
data comes from its bound `Output`.

Holds: `AutoLayoutRoutes`, `PanelRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/panels/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
