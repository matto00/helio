# HTTP

Cross-cutting HTTP infrastructure shared across every domain's routes: the
session/CSRF cookie machinery (`AuthDirectives`, `CookieConfig`), the ACL
directive and its `ResourceType`/`ResourceTypeRegistry` closed-over
owner-resolvers plus `AccessCheckerImpl`, request-body validation
(`RequestValidation`), distributed-trace propagation
(`TraceContextDirective`), and the top-level CORS/exception/rejection
handlers (`TopLevelErrorHandlers`).

Holds: `AccessCheckerImpl`, `AclDirective`, `AuthDirectives`, `CookieConfig`,
`RequestValidation`, `ResourceType`, `ResourceTypeRegistry`,
`TopLevelErrorHandlers`, `TraceContextDirective`.

Not a domain — none of these files are specific to any of the 13 domains;
each is wired into `ApiRoutes.scala`'s composition root once and used by
every domain's route classes. Does NOT hold: domain-specific route classes
(`api/routes/<domain>/`), protocol wire types (`api/protocols/<domain>/`, or
the root `IdParsing`/`PaginationProtocol`/`ResourceProtocol`), or business
logic (`services/<domain>/`).
