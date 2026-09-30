## ADDED Requirements

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
