# tier-gated-assistant-access Specification

## Purpose
Assistant/chat endpoints are gated by account tier — free-tier users are denied with a machine-readable error the frontend renders as a request-access prompt, beta-tier converse is capped per UTC day, and owner-tier is unlimited — controlling Claude cost exposure and rollout.. Update Purpose after archive.

## Requirements

### Requirement: Free-tier users are denied all assistant conversation endpoints
The system SHALL reject requests from a `free`-tier user on every `AssistantConversationRoutes`
endpoint (conversation list, create, read/messages, converse, and the PATCH rename/pin operation)
with `403 Forbidden`. The response body SHALL be JSON carrying a machine-readable error code
`TIER_FORBIDDEN` alongside a human-readable message, so the client can distinguish this denial from a
generic authorization failure. The check SHALL run after authentication and before any handler logic
or persistence.

#### Scenario: Free-tier user is denied on every chat surface
- **WHEN** a `free`-tier user calls any assistant conversation endpoint
- **THEN** the system returns `403 Forbidden` with a JSON body containing `code = "TIER_FORBIDDEN"`
  and a human-readable message
- **AND** no conversation or message row is created or modified

#### Scenario: Denial is distinguishable from ownership 403s
- **WHEN** a `free`-tier user is denied by the tier gate
- **THEN** the response body's `code` field is `TIER_FORBIDDEN`, which no other assistant error uses

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

### Requirement: Owner-tier users are unlimited
An `owner`-tier user SHALL pass the tier gate on every assistant conversation endpoint with no daily
cap applied — no message counting SHALL gate an owner's converse call.

#### Scenario: Owner converses past the beta limit
- **WHEN** an `owner`-tier user has sent more messages today than the beta limit and calls converse
- **THEN** the request proceeds normally

### Requirement: Frontend surfaces tier denials as actionable states
The frontend assistant feature SHALL recognise the `TIER_FORBIDDEN` and `CHAT_LIMIT_REACHED` error
codes from assistant endpoints and render them as distinct, styled states — a "request access" prompt
for `TIER_FORBIDDEN` and a "daily limit reached" notice for `CHAT_LIMIT_REACHED` — never a generic or
raw error. The authenticated-user state SHALL include the user's tier so the assistant surface can
render the request-access state proactively for `free`-tier users.

#### Scenario: Free-tier user sees a request-access prompt, not a raw error
- **WHEN** a `free`-tier user opens the assistant surface or receives a `TIER_FORBIDDEN` response
- **THEN** the assistant UI shows a dedicated request-access state explaining chat is limited-access
- **AND** no raw error message, toast of the raw payload, or generic failure state is shown

#### Scenario: Beta user at the cap sees a limit-reached notice and can still read
- **WHEN** a `beta`-tier user receives a `CHAT_LIMIT_REACHED` response from converse
- **THEN** the assistant UI shows a limit-reached notice (including that it resets daily) while the
  existing transcript remains visible and readable

### Requirement: Authoring and refinement routes enforce the assistant tier gate
`POST /api/authoring/dashboard` (buffered and streaming) and `POST /api/refinements` SHALL apply the same tier gate
and the same shared daily usage counter as the assistant converse endpoint, before any model call is made. A `free`
caller SHALL receive 403 with code `TIER_FORBIDDEN`; a `beta` caller SHALL consume one unit of the shared daily counter
per request and receive 429 with code `CHAT_LIMIT_REACHED` (carrying `limit`) once the limit is reached; an `owner`
caller SHALL never be denied or counted. The response body shape SHALL match the assistant's tier errors.

#### Scenario: Free-tier caller is denied on authoring
- **WHEN** a `free`-tier user POSTs `/api/authoring/dashboard` (with or without `stream=true`)
- **THEN** the response is 403 `TIER_FORBIDDEN` and no model call is made

#### Scenario: Free-tier caller is denied on refinement
- **WHEN** a `free`-tier user POSTs `/api/refinements`
- **THEN** the response is 403 `TIER_FORBIDDEN` and no model call is made

#### Scenario: Beta caller shares one daily counter
- **WHEN** a `beta` user at `limit - 1` assistant messages today POSTs either route once and then once more
- **THEN** the first succeeds and the second returns 429 `CHAT_LIMIT_REACHED` with `limit`, and assistant converse
  also returns 429 for that user that day

#### Scenario: Owner is unaffected
- **WHEN** an `owner` user calls either route beyond the beta limit
- **THEN** every call proceeds and no usage is recorded

#### Scenario: Unconfigured model key still degrades to 503
- **WHEN** `ANTHROPIC_API_KEY` is unset and any caller POSTs either route
- **THEN** the response is 503 and no usage is charged

#### Scenario: Non-model sub-routes are not metered
- **WHEN** a caller reads an authoring conversation or records an authoring outcome
- **THEN** no usage is charged and no model call is made

### Requirement: Refinement surface renders tier denials
The refinement chat surface SHALL display the server's tier-denial or limit-reached message when `/api/refinements`
returns 403 or 429, rather than a generic failure.

#### Scenario: Refinement shows limit-reached
- **WHEN** `/api/refinements` returns 429 `CHAT_LIMIT_REACHED`
- **THEN** the refinement drawer shows the server message as its error state
