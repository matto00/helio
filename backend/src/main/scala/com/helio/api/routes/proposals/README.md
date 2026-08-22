# Routes — Proposals

Generating a NEW artifact: dashboard/pipeline authoring proposal routes and the combined-proposal wrapper route.

Holds: `CombinedProposalRoutes`, `DashboardAuthoringRoutes`, `DashboardProposalRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/proposals/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
