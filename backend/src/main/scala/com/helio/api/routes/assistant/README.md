# Routes — Assistant

Assistant conversation HTTP routes.

Holds: `AssistantConversationRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/assistant/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
