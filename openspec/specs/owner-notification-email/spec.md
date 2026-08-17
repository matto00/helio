# owner-notification-email Specification

## Purpose
The codebase's first outbound-email capability: an env-configured Resend REST client (RESEND_API_KEY + HELIO_EMAIL_FROM) with explicit send outcomes, a never-logged key, and absent-config degradation instead of boot failure.
## Requirements
### Requirement: Env-configured outbound email via Resend
The system SHALL provide an outbound email capability backed by the Resend REST API
(`POST https://api.resend.com/emails`), configured entirely from environment variables: `RESEND_API_KEY`
(bearer credential) and `HELIO_EMAIL_FROM` (sender address). When either variable is unset, the capability
SHALL be absent (callers observe an unconfigured state) and the backend SHALL still boot normally. The API key
SHALL never be logged and SHALL be redacted from any config `toString`/debug output.

#### Scenario: Backend boots without email configuration
- **WHEN** the backend starts with `RESEND_API_KEY` unset
- **THEN** startup succeeds and email-dependent endpoints report their unconfigured degradation

#### Scenario: Send performs an authenticated Resend API call
- **WHEN** a caller sends an email through the capability
- **THEN** an HTTPS request is made to the Resend emails endpoint with a bearer `RESEND_API_KEY` header,
  the configured from-address, and the given recipients, subject, and text body

#### Scenario: API key never appears in logs
- **WHEN** email configuration is loaded or a send fails
- **THEN** no log line or error message contains the API key

### Requirement: Send outcomes are explicit
The email capability SHALL report success only when the provider accepts the message, and SHALL surface
provider rejections and transport failures as errors distinguishable from success, without retrying
automatically.

#### Scenario: Provider rejection surfaces as an error
- **WHEN** the Resend API responds with a non-success status
- **THEN** the caller observes a send failure (not a success), with no automatic retry

