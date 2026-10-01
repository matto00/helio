# Routes — First run

`POST /api/first-run/dashboard`, the empty-workspace drop-zone build.

Holds: `FirstRunRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — the route
is a thin Pekko HTTP `Directives` shell that delegates to
`services/firstrun/` and maps the result via `ServiceResponse`
(`api/routes/`, stays at root). Deliberately not tier-gated.
