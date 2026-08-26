## Purpose

Provides a reusable, per-principal request rate limit for `/api` routes so a single noisy
authenticated user or PAT cannot exhaust backend capacity, with 429 responses that tell the caller
when to retry. IP-based keying for unauthenticated/invalid-credential requests is deferred to
HEL-837 (see this change's design.md "Scope split" section) — this capability's shipped scope
covers authenticated (session/PAT) keying only.

## ADDED Requirements

### Requirement: Requests under the configured limit pass through
The system SHALL allow a request to proceed to its route handler when the caller's current bucket
count is below the configured limit for the active window.

#### Scenario: Under-limit request succeeds
- **WHEN** a caller has made fewer requests than the configured limit within the current window
- **THEN** the request is passed through to the route handler unmodified

### Requirement: Requests over the configured limit are rejected with 429
The system SHALL complete the request with HTTP 429 Too Many Requests, a `Retry-After` header
indicating the number of seconds until the window resets, and a JSON body matching the existing
`ErrorResponse` shape when the caller's bucket is exhausted.

#### Scenario: Over-limit request is rejected
- **WHEN** a caller has already made the configured limit of requests within the current window
- **THEN** the system responds with status 429, a `Retry-After` header, and a JSON `ErrorResponse` body
- **AND** the route handler is never invoked for the rejected request

### Requirement: Bucket key is resolved from the authenticated principal
The system SHALL key the rate-limit bucket on the authenticated user's id when the request carries
a valid session, and separately on the PAT token's id when the request is authenticated via a
personal access token, so that a single PAT's usage cannot exhaust the budget of other PATs or the
session budget belonging to the same user.

#### Scenario: Two different users have independent budgets
- **WHEN** user A exhausts their configured limit
- **THEN** user B's requests, up to user B's own limit, are still passed through

#### Scenario: Two PATs belonging to the same user have independent budgets
- **WHEN** PAT 1 (belonging to user A) exhausts its configured limit
- **THEN** PAT 2, also belonging to user A, is still passed through up to its own limit
- **AND** user A's session-authenticated requests (not using either PAT) are unaffected by either PAT's usage

### Requirement: A request this directive cannot key on a session or PAT is not rate-limited by it
The system SHALL NOT rate-limit a request that carries no session/PAT credential at all, or one
that carries a session cookie or PAT bearer token that fails to resolve — such a request SHALL pass
through unconditionally, with no fallback key of any kind (never a shared literal key across all
such callers, and never a per-IP key; IP-based keying for these cases is deferred to HEL-837, see
this capability's Purpose). The directive SHALL be composable ahead of or around
`optionalAuthenticate` so this determination can be made before a principal is known.

#### Scenario: An unauthenticated request is never rate-limited by this directive
- **WHEN** a request carries no session cookie and no PAT bearer token
- **THEN** the request passes through regardless of how many times it repeats, unaffected by the configured limit

#### Scenario: An invalid session cookie is never rate-limited by this directive
- **WHEN** a request carries a session cookie that does not resolve to a valid session
- **THEN** the request passes through regardless of how many times it repeats

#### Scenario: An invalid PAT bearer token is never rate-limited by this directive
- **WHEN** a request carries a PAT bearer token that does not resolve to a valid token
- **THEN** the request passes through regardless of how many times it repeats

### Requirement: Limits are configurable via environment variable
The system SHALL read the default requests-per-window limit and window duration from environment
variables, applying documented defaults when unset, and SHALL allow individual routes to specify a
tighter limit than the global default.

#### Scenario: Default limit applies when env vars are unset
- **WHEN** the rate-limit environment variables are not set
- **THEN** the system applies its documented default requests-per-window and window duration

#### Scenario: A route-specific limit overrides the global default
- **WHEN** a route is wired with a limit tighter than the global default
- **THEN** that route's callers are throttled at the tighter limit, not the global default

### Requirement: The limiter store is abstracted behind a trait
The system SHALL define the counting/storage mechanism behind a trait so an in-process
implementation can be replaced by a distributed/shared implementation without changing call sites,
and SHALL document that the shipped in-process implementation enforces limits independently per
backend instance (so the effective limit under N concurrently running instances is approximately
N times the configured value).

#### Scenario: Per-instance caveat is documented
- **WHEN** the rate-limiting capability's documentation (CLAUDE.md prod env table or equivalent) is read
- **THEN** it states that limits are enforced per-instance under the in-process store, and that the
  effective limit scales with the number of running backend instances
