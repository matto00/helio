## Purpose

Defines the authenticated, owner-only HTTP contract by which a dashboard's share links are minted, listed and
revoked, including the authorization rules that keep one tenant's links invisible and unmanageable to another.

## ADDED Requirements

### Requirement: Only the dashboard owner may manage its share tokens

The system SHALL restrict create, list and revoke operations on a dashboard's share tokens to that dashboard's
owner. A caller holding a Viewer or Editor grant on the dashboard SHALL NOT be able to create, list or revoke
its tokens. An unauthenticated caller SHALL NOT be able to perform any of these operations.

#### Scenario: Owner manages tokens
- **WHEN** the dashboard's owner requests to create, list, or revoke a share token
- **THEN** the operation is permitted

#### Scenario: Editor grantee cannot manage tokens
- **WHEN** an authenticated caller holding only an Editor grant attempts to create, list, or revoke a token
- **THEN** the request is refused and no token is created, disclosed, or revoked

#### Scenario: Viewer grantee cannot manage tokens
- **WHEN** an authenticated caller holding only a Viewer grant attempts to create, list, or revoke a token
- **THEN** the request is refused and no token is created, disclosed, or revoked

#### Scenario: Unauthenticated caller cannot manage tokens
- **WHEN** an unauthenticated caller attempts any share-token management operation
- **THEN** the request is refused and no token is created, disclosed, or revoked

#### Scenario: Management routes do not reveal other tenants' dashboards
- **WHEN** an authenticated caller requests token management for a dashboard they do not own
- **THEN** the response does not distinguish a dashboard that exists but belongs to another tenant from a
  dashboard that does not exist at all

### Requirement: Creating a share token returns its secret exactly once

The system SHALL provide an operation that mints a new share token for a dashboard, accepting an optional
expiry. The response SHALL include the token's secret value. The secret SHALL NOT be retrievable by any later
request. The response SHALL NOT include a fully-qualified share URL: the backend has no configured public
origin, so the client composes the URL from the token and its own origin.

#### Scenario: Mint without expiry
- **WHEN** the owner mints a share token without specifying an expiry
- **THEN** the response carries the token secret and a null expiry
- **THEN** the token authorizes public read until revoked

#### Scenario: Mint with expiry
- **WHEN** the owner mints a share token specifying a future expiry
- **THEN** the response carries the token secret and the stored expiry

#### Scenario: Expiry in the past is rejected
- **WHEN** the owner attempts to mint a token whose expiry is at or before the present moment
- **THEN** the request is rejected with a validation error and no token is created

### Requirement: Revoking a token is idempotent and takes effect immediately

The system SHALL provide an operation that revokes a named share token. Revoking an already-revoked token
SHALL succeed without changing the outcome. After revocation the token SHALL cease to authorize access on the
very next request.

#### Scenario: Revoke a live token
- **WHEN** the owner revokes a token that is currently valid
- **THEN** the operation succeeds and the token is marked revoked

#### Scenario: Revoking twice is safe
- **WHEN** the owner revokes a token that is already revoked
- **THEN** the operation succeeds and the token remains revoked

#### Scenario: Revoking a token that does not exist does not leak
- **WHEN** the owner attempts to revoke a token identifier that does not exist under their dashboard
- **THEN** the response does not reveal whether that identifier exists elsewhere

### Requirement: The share-token contract is declared in the project's contract surfaces

The system SHALL declare the request and response shapes for share-token creation, listing and revocation as
JSON Schema files under `schemas/`, and SHALL describe the endpoints and their behaviour as requirements under
`openspec/specs/`. This project has no OpenAPI document; those two surfaces together are the contract.

#### Scenario: Contract is discoverable
- **WHEN** a consumer inspects the project's contract surfaces
- **THEN** the share-token request and response bodies are described by JSON Schema files under `schemas/`
- **THEN** the endpoints and their denial behaviour are described by requirements under `openspec/specs/`
