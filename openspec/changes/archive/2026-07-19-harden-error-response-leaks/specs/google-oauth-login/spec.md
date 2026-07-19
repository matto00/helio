## ADDED Requirements

### Requirement: Google OAuth callback — unexpected internal failure

The system SHALL return a generic `500 Internal Server Error` body when the OAuth callback fails unexpectedly. When the failure is not a denied consent, an invalid CSRF state, a missing code, or a recognized upstream token/userinfo error (i.e. an unexpected internal exception), the system SHALL respond with `{ "error": "Internal server error" }` and SHALL NOT include the raw exception message or any internal detail in the client response. The full exception, including its stack trace, SHALL be logged server-side for diagnosis.

#### Scenario: Unexpected exception during code exchange

- **WHEN** `GET /api/auth/google/callback?code=<code>` is received with a valid CSRF
  state and processing throws an unexpected exception that is not a recognized upstream
  OAuth error
- **THEN** the system returns `500 Internal Server Error` with
  `{ "error": "Internal server error" }`
- **AND** the response body contains no raw exception message or internal detail
- **AND** the full exception and stack trace are logged server-side
