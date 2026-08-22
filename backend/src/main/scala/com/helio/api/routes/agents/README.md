# Routes — Agents

Agent memory and preference HTTP routes.

Holds: `AgentMemoryRoutes`, `AgentPreferencesRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/agents/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
