## MODIFIED Requirements

### Requirement: ACL directive is decoupled from resource types via a resolver registry
The directive SHALL accept a `ResourceTypeRegistry` (injected at construction) and use it to look up
the ownership resolver for a given resource type key. Callers pass `resourceType: String` and
`resourceId: String` instead of a raw resolver function. Adding support for a new resource type SHALL
require registering a single `ResourceType` entry in the registry — no copy-paste of ACL logic and no
changes to `AclDirective`.

If the registry does not contain the requested resource type key, `AclDirective` SHALL complete with
`500 Internal Server Error` and log an error.

#### Scenario: New resource type registered without modifying directive
- **WHEN** a new resolver is registered for a new resource type in the `ResourceTypeRegistry` passed to `AclDirective`
- **THEN** the existing `authorizeResource` directive enforces ownership for that type without code changes to the directive itself

#### Scenario: Unknown resource type key returns 500
- **WHEN** a route calls `authorizeResource` with a resource type key not present in the registry
- **THEN** the directive completes with `500 Internal Server Error`
