## ADDED Requirements

### Requirement: Sharing authorization accepts a valid share token

The sharing authorization path SHALL accept a share token from any caller, authenticated or not, and SHALL
grant `ResourceAccess = Viewer` when that token is valid for the requested resource — that is, the token
exists, is unrevoked, and is either non-expiring or not yet expired.

The token SHALL be consulted whenever grant-based resolution would otherwise DENY — both the authenticated
caller with no grant and the unauthenticated caller with no public-viewer grant. The token SHALL NOT be
confined to the unauthenticated path: a caller holding a Helio session who is not the owner and holds no grant
MUST still be authorized by a valid share link. The token SHALL NOT downgrade an access level that
grant-based resolution already granted: an owner remains `Owner` and an editor grantee remains `Editor`.

This path is additive: the existing public-viewer grant path SHALL continue to authorize exactly as it does
today, and a resource reachable by a public-viewer grant SHALL remain reachable without a token.

#### Scenario: Valid token grants Viewer to an unauthenticated caller
- **WHEN** an unauthenticated request presents a valid share token for the requested resource
- **THEN** the inner route handler executes with `ResourceAccess = Viewer`

#### Scenario: Existing public-viewer grant path is unaffected
- **WHEN** an unauthenticated request presents no token and the resource has a public viewer grant
- **THEN** the inner route handler executes with `ResourceAccess = Viewer`, as before

#### Scenario: Authenticated non-grantee with a valid token is authorized
- **WHEN** a caller holding a valid Helio session, who is neither the owner nor a grantee, presents a valid
  share token for the requested resource
- **THEN** the inner route handler executes with `ResourceAccess = Viewer`
- **THEN** the caller does NOT receive `403 Forbidden`

#### Scenario: A token never downgrades existing access
- **WHEN** an owner or an editor grantee makes a request that also carries a valid share token
- **THEN** the caller retains `ResourceAccess = Owner` or `ResourceAccess = Editor` respectively

#### Scenario: Token for a different resource does not authorize
- **WHEN** an unauthenticated request presents a token that is valid but was minted for a different resource
- **THEN** access is denied

### Requirement: Token denial is indistinguishable from the private-resource denial

When a caller presents a token that is expired, revoked, nonexistent, or bound to another resource, the system
SHALL complete exactly the denial that grant-based resolution would have produced without any token at all —
for an unauthenticated caller with no public-viewer grant, `404 Not Found` with the same error body used for a
private or absent resource. Presenting an invalid token SHALL NOT introduce any denial shape that is not
already reachable without a token. The response SHALL NOT distinguish the invalid-token cases from one
another, nor from a request for a resource that does not exist.

#### Scenario: Expired token is denied as not-found
- **WHEN** an unauthenticated request presents an expired token and no public viewer grant applies
- **THEN** the server responds with `404 Not Found` and the same body used for a private resource

#### Scenario: Revoked token is denied as not-found
- **WHEN** an unauthenticated request presents a revoked token and no public viewer grant applies
- **THEN** the server responds with `404 Not Found` and the same body used for a private resource

#### Scenario: Nonexistent token is denied as not-found
- **WHEN** an unauthenticated request presents a token that has never existed
- **THEN** the server responds with `404 Not Found` and the same body used for a private resource

#### Scenario: Denial does not distinguish a real dashboard from an absent one
- **WHEN** an unauthenticated caller presents an invalid token for a dashboard that exists, and separately for a
  dashboard identifier that does not exist
- **THEN** the two responses are identical in status and body
