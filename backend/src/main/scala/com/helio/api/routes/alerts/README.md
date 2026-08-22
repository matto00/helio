# Routes — Alerts

Alert rule and alert event HTTP routes.

Holds: `AlertEventRoutes`, `AlertRuleRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/alerts/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
