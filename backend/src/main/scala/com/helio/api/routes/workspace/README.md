# Routes — Workspace

Cross-domain workspace-wide routes (NL search/get_resource, teardown).

Holds: `WorkspaceRoutes`.

`HealthRoutes` (a domain-agnostic `GET /health` check with no natural domain
home) moved to `api/routes/` root (HEL-811) — see that directory's README.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/workspace/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
