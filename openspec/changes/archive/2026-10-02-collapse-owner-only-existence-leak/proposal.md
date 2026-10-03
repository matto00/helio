## Why

`AccessChecker.requireOwnerOnly`, `AccessChecker.requireAccess` (authenticated no-grant arm) and `AclDirective.authorizeResource` / `authorizeResourceWithSharing` (authenticated no-grant arm) answer a real-but-foreign resource with `403` and an absent one with `404`. Any authenticated caller can therefore probe resource-id existence across tenants. CONTRIBUTING.md mandates existence-not-leaked semantics; the owner has ruled (HEL-1002) to collapse globally rather than per route.

## What Changes

- "Caller has no grant at all on a real resource" is denied exactly as "resource absent": `404` with the caller-supplied not-found message, byte-identical serialized body, in `requireOwnerOnly`, `requireAccess`, `AclDirective.authorizeResource`, `AclDirective.authorizeResourceWithSharing`.
- Remaining `Forbidden` producers are audited and classified; those where the caller has no grant (existence oracles) switch to 404; legitimate 403s (Viewer on a visible resource, tier gating, PAT scope, form-submit by a visible-but-not-owner caller) are unchanged.
- Remove `ShareTokenService.mapForbiddenToNotFound` (HEL-590 local mapping).
- Frontend: update any 403-keyed handling on these routes. helio-mcp: check/update error mapping.
- Parametrised cross-route tests asserting identical (status, body) for nonexistent vs foreign ids.
- **BREAKING (intended)**: the response status for foreign resources on owner-only routes changes 403 -> 404.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `acl-enforcement`: no-grant authenticated denial becomes 404 with the absent-resource body, on both service-layer and directive paths.

## Impact

- Backend: `AccessCheckerImpl`, `AclDirective`, `ShareTokenService`, any service/route Forbidden site found to be an oracle; backend specs asserting 403 for no-grant.
- Frontend: 403-keyed error handling for dashboards/pipelines/permissions/share routes.
- helio-mcp: error mapping.
- No schema, no migration.
