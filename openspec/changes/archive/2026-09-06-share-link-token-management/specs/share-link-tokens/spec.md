## Purpose

Defines the share-token contract for dashboards: an opaque, unguessable, per-link credential with optional
expiry and explicit revocation, together with the validation predicate that decides whether a presented token
authorizes public read — and the non-disclosure guarantees that predicate must uphold.

## ADDED Requirements

### Requirement: Share tokens are cryptographically unguessable

The system SHALL generate every share token from a cryptographically secure pseudorandom number generator with
at least 128 bits of entropy. The system SHALL NOT derive a token from a sequential identifier, a resource
identifier, a timestamp, a counter, or any other predictable or caller-observable input.

#### Scenario: Generated tokens are unpredictable
- **WHEN** two share tokens are minted for the same dashboard in immediate succession
- **THEN** neither token is derivable from the other, from the dashboard identifier, or from the creation time
- **THEN** each token carries at least 128 bits of entropy

#### Scenario: Tokens are drawn from a secure generator
- **WHEN** a share token is minted
- **THEN** its randomness originates from a cryptographically secure generator, not a general-purpose PRNG

### Requirement: A share token authorizes public read only while valid

A share token SHALL be considered valid if and only if it exists, has not been revoked, and either has no
expiry or has an expiry strictly in the future relative to the time of the request. A valid token SHALL
authorize read access to its dashboard at Viewer level. An invalid token SHALL authorize nothing.

#### Scenario: Valid unexpired token authorizes read
- **WHEN** a caller presents a token that exists, is unrevoked, and has no expiry or a future expiry
- **THEN** the caller is granted Viewer access to that token's dashboard

#### Scenario: Expired token authorizes nothing
- **WHEN** a caller presents a token whose expiry is at or before the current time
- **THEN** the caller is granted no access

#### Scenario: Revoked token authorizes nothing immediately
- **WHEN** a token is revoked and the same token is presented on a subsequent request
- **THEN** the caller is granted no access, with no grace period and no cached authorization

#### Scenario: Expiry boundary is exclusive
- **WHEN** a token's expiry is exactly equal to the current time
- **THEN** the token is treated as expired and grants no access

### Requirement: Invalid tokens are indistinguishable from one another

The system SHALL respond identically to an expired token, a revoked token, and a token that has never existed.
The response status, the response body, and any other caller-observable signal SHALL NOT differ between these
three cases. This requirement exists because any observable difference turns the endpoint into an existence
oracle for private dashboards.

Scope: this requirement governs the response status and body. It deliberately does NOT claim wall-clock
indistinguishability. Validation SHALL NOT introduce an *additional* query, branch, or round-trip on any one
failure path relative to the others, so the failure modes do not differ from each other in cost; but the
number of queries taken before validation is reached does differ between an absent resource and an existing
private one, and that residual asymmetry is an accepted, recorded limitation rather than a satisfied
guarantee. See design.md — Risks.

#### Scenario: Revoked and nonexistent tokens are identical to the caller
- **WHEN** a caller presents a revoked token, and separately presents a token that has never existed
- **THEN** both responses carry the same status code
- **THEN** both responses carry the same body
- **THEN** neither response reveals whether the dashboard or the token exists

#### Scenario: Expired and nonexistent tokens are identical to the caller
- **WHEN** a caller presents an expired token, and separately presents a token that has never existed
- **THEN** both responses carry the same status code and the same body

#### Scenario: No failure path costs more than another
- **WHEN** a token is rejected as unknown, as revoked, as expired, or as bound to another resource
- **THEN** each rejection takes the same single lookup, with all remaining state checks performed in memory
- **THEN** no rejection path issues an extra query or round-trip that the others do not

### Requirement: Tokens are not disclosed after minting

The system SHALL return a token's secret value only in the response to the request that mints it. Subsequent
list or read operations SHALL identify a token by a non-secret identifier and non-secret metadata only, and
SHALL NOT return the secret value.

#### Scenario: Listing tokens does not reveal secrets
- **WHEN** an owner lists the share tokens for a dashboard
- **THEN** each entry carries a non-secret identifier, its creation time, its expiry if set, and its revocation
  state
- **THEN** no entry carries the token's secret value
