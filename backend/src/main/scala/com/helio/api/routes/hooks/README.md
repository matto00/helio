# Routes — Hooks

Webhook-trigger HTTP routes.

Holds: `HookRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/hooks/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
