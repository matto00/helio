# HEL-40 — ACL extensibility: generic resource type registry

## Summary

Design the ACL layer so that future user-created resource types can plug in without modifying core auth logic.

## Scope

- Define a `ResourceType` trait/interface with a string key (e.g. `"dashboard"`, `"panel"`)
- `resource_permissions` table uses `resource_type: String` rather than separate join tables per type
- Registry that maps resource type keys to ownership resolvers (used by the ACL directive)
- Document the contract for registering a new resource type

## Acceptance criteria

- Adding a new resource type (e.g. `"report"`) requires only: a migration adding the table, and registering the type in the registry
- Existing dashboard/panel ACL behaviour is unchanged
- The resource type key is validated at startup — unknown types fail fast

## Context from HEL-36

The codebase now has `AclDirective.scala` with `authorizeResource` (owner-only) and `authorizeResourceWithSharing` (owner/editor/viewer via `resource_permissions` table). It is already resource-type-agnostic — callers pass a resolver function. `ResourcePermissionRepository` handles the permissions table. HEL-40 is about formalising this into a proper `ResourceType` trait/registry so new types plug in without modifying core ACL logic.
