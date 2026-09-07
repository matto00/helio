## ADDED Requirements

### Requirement: Google OAuth CSRF state round trip is process-independent

The system SHALL issue a CSRF state value on `GET /api/auth/google`, include it as the `state` query
parameter on the redirect to Google's consent screen, and require a matching, unconsumed, unexpired
state on `GET /api/auth/google/callback`. The round trip SHALL succeed when the consent redirect and
the callback are served by **different processes**, and when the process that issued the state has
terminated before the callback arrives.

The system SHALL reject a callback whose `state` parameter is missing, was never issued, has expired,
or has already been consumed, with `400 Bad Request` and `{ "message": "Invalid or missing OAuth state
parameter" }`. This rejection SHALL occur before the authorization code is exchanged with Google.

*Correction, recorded deliberately (evaluation-1.md CR3, escalated to this spec file on review):*
this requirement originally read `{ "error": ... }` in every occurrence below. That was wrong when
written, not a regression from this change — `ErrorResponse` (`ResourceProtocol.scala`) has
serialized its single field as `message`, never `error`, since long before this ticket existed
(HEL-236, predates this change by hundreds of commits). The route code was always correct; only
this planning artifact was wrong. Verified live against the running server during delivery
(`GoogleOAuthRoutesSpec`'s route-level tests assert the exact body with `shouldBe`).

#### Scenario: Consent redirect issues a state parameter

- **WHEN** a `GET /api/auth/google` request is made
- **THEN** the system responds with `302 Found` whose `Location` includes a non-empty `state` query
  parameter
- **AND** that state validates successfully on a subsequent callback

#### Scenario: Callback served by a different process than the initiation succeeds

- **WHEN** a state is issued by one serving process
- **AND** `GET /api/auth/google/callback?code=<valid-code>&state=<that-state>` is handled by a
  different serving process that shares no in-memory state with the issuing process
- **THEN** the state check passes and the callback proceeds to the authorization code exchange

#### Scenario: Missing state is rejected

- **WHEN** `GET /api/auth/google/callback?code=<valid-code>` is received with no `state` parameter
- **THEN** the system returns `400 Bad Request` with `{ "message": "Invalid or missing OAuth state parameter" }`
- **AND** no authorization code exchange with Google is attempted

#### Scenario: Forged state is rejected

- **WHEN** `GET /api/auth/google/callback?code=<valid-code>&state=<never-issued-value>` is received
- **THEN** the system returns `400 Bad Request` with `{ "message": "Invalid or missing OAuth state parameter" }`
- **AND** no authorization code exchange with Google is attempted

#### Scenario: Expired state is rejected

- **WHEN** `GET /api/auth/google/callback?code=<valid-code>&state=<state issued more than 300 seconds earlier>`
  is received
- **THEN** the system returns `400 Bad Request` with `{ "message": "Invalid or missing OAuth state parameter" }`

#### Scenario: Replayed state is rejected

- **WHEN** a callback has already completed successfully using a given state
- **AND** a second callback presents the same state value
- **THEN** the second request returns `400 Bad Request` with
  `{ "message": "Invalid or missing OAuth state parameter" }`
