# Routes — Workspace

Cross-domain workspace-wide routes (NL search/get_resource, teardown) plus `HealthRoutes` — a domain-agnostic `GET /health` check with no natural domain home; placed here as the closest analogue to a system-wide/account-level concern rather than inventing a 14th category.

Holds: `HealthRoutes`, `WorkspaceRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/workspace/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
