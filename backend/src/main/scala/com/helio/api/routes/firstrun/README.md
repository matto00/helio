# Routes — First run

`POST /api/first-run/dashboard`, the empty-workspace drop-zone build, and
`POST /api/first-run/template`, the persona sample-data build (HEL-1210; `{"template": "<slug>"}`,
`400` on an unknown slug).

Holds: `FirstRunRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — the route
is a thin Pekko HTTP `Directives` shell that delegates to
`services/firstrun/` and maps the result via `ServiceResponse`
(`api/routes/`, stays at root). Deliberately not tier-gated.
