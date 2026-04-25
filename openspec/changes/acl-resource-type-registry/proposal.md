## Why

The ACL directive (`AclDirective.scala`) is already resource-type-agnostic via injected resolver functions,
but those resolvers are wired ad-hoc in `ApiRoutes`. There is no enforced contract, no startup validation,
and no single place to look up which types are registered. Adding a new resource type today means knowing
where to copy the wiring — it is not self-documenting and won't fail fast on misconfiguration.

## What Changes

- Introduce a `ResourceType` sealed trait with a `key: String` (e.g. `"dashboard"`, `"panel"`) and an
  ownership resolver function.
- Introduce a `ResourceTypeRegistry` that holds all registered types, is injected into `AclDirective`,
  and validates at startup that no key is duplicated.
- Replace the ad-hoc per-route resolver arguments in `ApiRoutes` with registry lookups.
- Register the four existing types (`dashboard`, `panel`, `data-source`, `data-type`) in the registry.
- Startup fails fast if a route references an unknown resource type key.

## Capabilities

### New Capabilities

- `acl-resource-type-registry`: `ResourceType` trait and `ResourceTypeRegistry` — the extensibility contract
  for plugging in new resource types without modifying ACL logic.

### Modified Capabilities

- `acl-enforcement`: The directive's resolver lookup now goes through the registry rather than per-call
  injection. The behavioral guarantees (403/404 responses) are unchanged; only the wiring pattern changes.

## Impact

- Backend only: `AclDirective.scala`, `ApiRoutes.scala`, new `ResourceTypeRegistry.scala`.
- No API surface changes, no DB migrations, no frontend changes.
- Existing dashboard/panel/data-source/data-type ACL behaviour is fully preserved.

## Non-goals

- No new permission grant endpoints or roles.
- No frontend changes.
- No changes to `resource_permissions` table schema.
