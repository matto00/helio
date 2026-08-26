# audit-actor-attribution Specification

## Purpose
Defines how the acting credential's provenance (session cookie vs. PAT bearer token) and the
resolving token's id are threaded from identity resolution into every recorded audit event, so
audit rows distinguish UI, PAT-script, and (until a reliable signal exists) MCP-driven mutations.

## Requirements

### Requirement: A session-cookie-authenticated mutation is recorded with source `ui` and no token id
When a request is authenticated via the `helio_session` cookie, any audit event written for that
request's mutation SHALL carry `source=ui` and a null `actor_token_id`.

#### Scenario: A dashboard update via session cookie records ui/null
- **WHEN** an authenticated session-cookie request updates a dashboard
- **THEN** the resulting `dashboard.update` audit event has `source=ui` and `actor_token_id=null`

### Requirement: A PAT-bearer-authenticated mutation is recorded with source `pat` and the resolving token's id
When a request is authenticated via a `helio_pat_`-prefixed `Authorization: Bearer` token, any
audit event written for that request's mutation SHALL carry `source=pat` and `actor_token_id` set
to the id of the token that resolved the request's identity.

#### Scenario: The same dashboard update via a PAT records pat/token-id
- **WHEN** the same dashboard-update request is instead authenticated with a valid `helio_pat_`
  bearer token
- **THEN** the resulting `dashboard.update` audit event has `source=pat` and `actor_token_id` equal
  to that token's id

### Requirement: MCP-originated PAT requests are recorded as `pat` absent a reliable distinguishing signal
Because no dedicated token label, scope, or client header reliably distinguishes an MCP-server
(helio-mcp) request from any other PAT-bearer request today, such requests SHALL be recorded with
`source=pat`, identically to any other PAT-authenticated caller — not misclassified as `ui` or
silently dropped, and not guessed as `mcp` without a real signal to key on.

#### Scenario: An MCP-server request records pat, not ui or mcp
- **WHEN** a mutation is made by helio-mcp authenticating with a `helio_pat_` bearer token
- **THEN** the resulting audit event has `source=pat`

### Requirement: A scheduler-triggered mutation is recorded with source `system`
When a mutation is produced by an unattended, system-triggered process (e.g. a cron-fired scheduled
pipeline run) rather than a live request credential, the resulting audit event SHALL carry
`source=system`, not `ui`.

#### Scenario: A cron-fired pipeline run records system, not ui
- **WHEN** a pipeline run is submitted by the scheduler (not a live API request) for a pipeline
  with an active schedule
- **THEN** the resulting `pipeline.run.submit` audit event has `source=system`

### Requirement: Historical audit attribution survives token revocation
Revoking or deleting an API token SHALL NOT delete, null out, or otherwise alter the
`actor_token_id` of any audit event previously recorded against that token — the reference is a
soft pointer with no cascading effect on already-written audit rows.

#### Scenario: Revoking a token leaves its prior audit rows intact
- **GIVEN** an audit event was recorded with `actor_token_id` set to token T
- **WHEN** token T is revoked (deleted)
- **THEN** the previously recorded audit event still has `actor_token_id` set to T's id and is
  otherwise unchanged
