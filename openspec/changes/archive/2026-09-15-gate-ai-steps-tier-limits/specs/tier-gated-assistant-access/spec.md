## MODIFIED Requirements

### Requirement: Beta-tier message sends are capped per day
A `beta`-tier user SHALL be able to use all assistant conversation endpoints, except that sending a
message (the converse endpoint) SHALL be capped at a configurable number of user messages per UTC
day. The limit SHALL come from configuration (env-var-backed with a conservative built-in default)
and SHALL be enforced by counting the user's converse message sends for the current UTC day
(persisted in a per-user daily usage record — the transcript blob has no per-message timestamps to
count from) before invoking the model. A request over the cap SHALL return `429 Too Many Requests`
with a JSON body carrying machine-readable code `CHAT_LIMIT_REACHED`, the configured limit, and a
human-readable message. An over-cap request SHALL NOT invoke the model and SHALL NOT persist any
turns.

The SAME per-user daily record and the SAME configured limit SHALL also count pipeline-triggered AI
model calls, so a user has ONE combined daily AI budget rather than a separate allowance per
surface. Chat sends and pipeline AI calls SHALL therefore draw down the same counter, and each
surface SHALL report its own denial in its own established shape (chat: `429` with
`CHAT_LIMIT_REACHED`; pipeline: a named step failure).

#### Scenario: Beta user under the cap converses normally
- **WHEN** a `beta`-tier user who has sent fewer messages today than the configured limit calls the
  converse endpoint
- **THEN** the request proceeds normally

#### Scenario: Beta user at the cap gets a clear limit-reached error
- **WHEN** a `beta`-tier user who has already sent the configured limit of messages today calls the
  converse endpoint
- **THEN** the system returns `429 Too Many Requests` with a JSON body containing
  `code = "CHAT_LIMIT_REACHED"` and the configured limit
- **AND** no model call is made and no turns are persisted

#### Scenario: Beta cap does not block reading or managing conversations
- **WHEN** a `beta`-tier user at the daily cap lists conversations or reads messages
- **THEN** the request succeeds

#### Scenario: Daily usage records are isolated per user by RLS
- **WHEN** one user's database context attempts to read or modify another user's daily usage record
- **THEN** row-level security prevents the access (no row visible, no row modified)

#### Scenario: Pipeline AI calls draw down the same daily counter
- **WHEN** a `beta`-tier user's pipeline issues AI model calls and the user then calls converse
- **THEN** the pipeline's calls have already counted against the same daily limit, and converse is
  denied with `CHAT_LIMIT_REACHED` once the combined total reaches the limit
