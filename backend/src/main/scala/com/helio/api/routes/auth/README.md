# Routes — Auth

Auth, MFA, API-token, OAuth, beta-access and permission HTTP routes.

Holds: `ApiTokenRoutes`, `AuthRoutes`, `BetaAccessRoutes`, `MfaRoutes`, `OAuthRoutes`, `PermissionRoutes`, `PipelinePermissionRoutes`.

Does NOT hold: HTTP routes for other domains, or business logic — most
route classes are thin Pekko HTTP `Directives` shells that delegate to a
`services/auth/` service and map their result via `ServiceResponse`
(`api/routes/`, stays at root).
