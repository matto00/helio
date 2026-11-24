# mcp-refresh-token-families Specification

## Purpose
Backend storage and PAT-confined routes for helio-mcp refresh-token families: hash-only state, atomic rotation, reuse revokes the PAT, and revoking the PAT ends its families.

## Requirements

### Requirement: Refresh-token family state is stored as a hash and dies with its PAT

The backend SHALL store refresh-token family state in `mcp_refresh_families` with: owner user id, the backing API
token id (foreign key to `api_tokens` with `ON DELETE CASCADE`), client id hash, resource, the SHA-256 hash of the
current token id, a generation counter, timestamps, and an expiry equal to the backing PAT's expiry (now + 90 days if
the PAT has none). The table SHALL have owner-only row-level security (enabled and forced). No raw refresh token or
token id SHALL be stored.

#### Scenario: Revoking the PAT deletes its families

- **WHEN** the user deletes the API token that backs one or more families
- **THEN** those family rows no longer exist

#### Scenario: Another user cannot see a family

- **WHEN** a family row is read on the app pool under another user's identity
- **THEN** no row is returned

### Requirement: Family routes are confined to the authenticating PAT

`POST /api/mcp-refresh-families` and `POST /api/mcp-refresh-families/:id/rotate` SHALL accept only an unscoped PAT
and SHALL act only on families whose backing token is the authenticating token. A session caller SHALL get `403`;
a scoped PAT SHALL be refused as on every other non-hook route; a family of another token or user, or an unknown id,
SHALL get `404`. Creating a family SHALL return `201 {familyId, expiresAt}`.

#### Scenario: Another PAT's family

- **WHEN** PAT B calls rotate on a family created with PAT A
- **THEN** the response is `404` and the family is unchanged

#### Scenario: Session caller

- **WHEN** a browser session (no PAT) calls `POST /api/mcp-refresh-families`
- **THEN** the response is `403` and no row is written

### Requirement: Rotation is atomic and reuse revokes the PAT

Rotate SHALL, in one transaction, replace the current token-id hash with the next one and increment the generation
only when the presented hash equals the current one, the client id hash and resource match, and the family has not
expired, answering `200 {generation, expiresAt}`. A presented hash that is well-formed but not current SHALL be
treated as reuse: the backing API token SHALL be deleted in the same transaction (cascading to all its families),
an audit event SHALL be recorded through the existing audit mechanism with action `token.revoke`, the token id as
resource id and details carrying `reason: "mcp_refresh_reuse"`, the family id and the generation (never token
material), and the answer SHALL be `409 {reason: "reused"}`. An expired family SHALL answer `409 {reason: "expired"}` and a client or
resource mismatch `409 {reason: "mismatch"}` with no state change. Two concurrent rotations with the same presented
hash SHALL yield exactly one `200`.

#### Scenario: Concurrent rotation

- **WHEN** two rotate calls present the same current hash at the same time
- **THEN** exactly one answers `200` and the other is treated as reuse

#### Scenario: Reuse

- **WHEN** rotate is called with the hash of a token id that was current before the last rotation
- **THEN** the answer is `409 {reason: "reused"}`, the backing PAT no longer authenticates, and one `token.revoke`
  audit event with `reason: "mcp_refresh_reuse"` exists for that token id
