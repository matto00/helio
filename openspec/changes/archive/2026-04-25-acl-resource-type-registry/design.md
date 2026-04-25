## Context

`AclDirective` (in `com.helio.api`) already accepts an injected `resolver: String => Future[Option[String]]`
per call-site, making it resource-type-agnostic in implementation. However, each route class (`DataTypeRoutes`,
`DataSourceRoutes`, `PanelRoutes`, `DashboardRoutes`, `PermissionRoutes`) independently defines its own
resolver lambda and passes it inline. There is no enforced naming contract, no central list of registered
types, and no startup guard against unknown or duplicated keys. The ticket asks for a formalised
`ResourceTypeRegistry` that enforces this contract at startup.

## Goals / Non-Goals

**Goals:**
- Introduce a `ResourceType` case class with a `key: String` and `ownerResolver: String => Future[Option[String]]`
- Introduce a `ResourceTypeRegistry` that holds all registered types, validates uniqueness of keys at
  construction time, and provides a lookup method used by `AclDirective`
- Register the four existing types (`dashboard`, `panel`, `data-source`, `data-type`) in `ApiRoutes`
- `AclDirective.authorizeResource` and `authorizeResourceWithSharing` accept a `ResourceTypeRegistry`
  lookup (or continue to accept resolver functions — see Decision 1)
- Startup fails immediately if keys are duplicated

**Non-Goals:**
- No new HTTP endpoints or permission roles
- No DB schema changes
- No frontend changes

## Decisions

### Decision 1: Registry injection into AclDirective vs. per-call lookup

**Options:**
- A: Inject the `ResourceTypeRegistry` into `AclDirective`; routes pass only the `resourceType: String` key.
- B: Keep per-call resolver injection; registry lives in `ApiRoutes` and is used to look up the resolver
  before calling the directive.

**Chosen: A.** Injecting the registry into `AclDirective` makes it the single source of truth. Routes pass a
string key — the directive looks up the resolver. This is the cleanest inversion of control and means
new resource types are registered in one place (the registry) rather than distributed across route classes.

### Decision 2: Sealed trait vs. case class

A `sealed trait ResourceType` with one case class per type is idiomatic Scala for a fixed enum, but it
requires modifying a sealed hierarchy file to add a new type — the opposite of the extensibility goal.
A plain `case class ResourceType(key: String, ownerResolver: ...)` with a mutable or builder-style
registry is more extensible. However, since the registry is built at startup and never mutated, an
`immutable.Map[String, ResourceType]` is sufficient.

**Chosen: case class + immutable registry.** Simpler, avoids sealed-hierarchy modification when adding
types.

### Decision 3: Startup validation location

Validation of key uniqueness and completeness must happen before the server begins accepting requests.
`HttpServer.scala` calls `new ApiRoutes(...)` and then `Http().newServerAt(...).bind(routes)`. Placing
validation inside `ResourceTypeRegistry` constructor (throwing `IllegalArgumentException` on duplicates)
ensures a crash-on-startup before any binding occurs.

**Chosen: constructor-time validation in `ResourceTypeRegistry`.**

## Risks / Trade-offs

- [Risk] Routes currently hold their own resolver lambdas as `private val`; after the change they are
  removed. Tests that construct route classes in isolation must now supply a registry — either the real
  one or a stub. → Mitigation: expose a companion `ResourceTypeRegistry.default(...)` factory for tests.

- [Risk] `authorizeResourceWithSharing` takes a `resourceType: String` and a separate resolver. With
  the registry, the `resourceType` string is sufficient (the registry supplies the resolver). This
  simplifies call-sites but is a behaviour-neutral change. → Low risk.

## Migration Plan

1. Add `ResourceType.scala` and `ResourceTypeRegistry.scala` to `com.helio.api`.
2. Modify `AclDirective` to accept `ResourceTypeRegistry` instead of per-call resolver.
3. Update `ApiRoutes` to build a `ResourceTypeRegistry` from the four repository resolvers, inject it
   into `AclDirective`.
4. Remove per-call resolver lambdas from each route class; replace with a registry key string.
5. Update `AclDirectiveSpec` to use the registry.
6. Run `sbt test` — all existing ACL tests must pass unchanged.

Rollback: the change is purely internal; no API contract changes. Reverting the Scala files is sufficient.

## Planner Notes

- Self-approved. This is a backend-only refactor with no API surface changes, no DB migrations, and no
  breaking behavior. All existing ACL behavior is preserved; only the wiring pattern changes.
- The `resource_permissions` table already uses a `resource_type: String` column (from HEL-36), so the
  registry key strings must match those values (`"dashboard"`, `"panel"`, `"data-source"`, `"data-type"`).
