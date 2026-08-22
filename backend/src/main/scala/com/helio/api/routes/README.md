# Routes

Pekko HTTP route definitions, split by domain (`routes/<domain>/`).
`ServiceResponse.scala` stays at this root: its `run`/`runWith` helpers map a
service's `Either[ServiceError, A]` result to an HTTP response, and its
`private[routes] statusCodeFor` is called from three cross-domain callers
(`RefinementRoutes`, `DashboardAuthoringRoutes`, `AssistantConversationRoutes`)
that need `routes` as the enclosing package for that qualified-private access
to keep working (design.md D3) — moving it would force widening that
qualifier to `private[api]`, the change's only forced access-qualifier edit.

No other file lives directly in `api/routes/` — every route class belongs
under one of the 13 domain subdirectories. See each subdirectory's own
README for what belongs there. `api/ApiRoutes.scala` (composition root,
stays at `api/` root) mounts every route class in the `~` chain that defines
the route surface and its mount order — unchanged by this split.
