# Routes — Dashboards

Dashboard HTTP routes, including the public/shared-dashboard and dashboard-contents/snapshot sub-routes.

Holds: `DashboardContentsRoutes`, `DashboardRoutes`, `DashboardSnapshotRoutes`, `PublicDashboardRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/dashboards/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
