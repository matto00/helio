# beta-access-request Specification

## Purpose
A free-tier user can request Beta access from Settings, notifying every configured owner email with enough requester identity to respond, with clean 503/502/429 degradation when email is unconfigured, failing, or rate-limited.
## Requirements
### Requirement: Free-tier user can request Beta access
The system SHALL expose an authenticated `POST /api/beta-access/request` endpoint. For a caller whose persisted
tier is `free`, the system SHALL send a notification email to every configured owner email
(`HELIO_OWNER_EMAILS`) containing at least the requester's email address, display name (when set), user id, and
account-creation time — enough to identify and respond to the requester. The endpoint SHALL respond success only
after the email provider accepts the message.

#### Scenario: Free user requests access and the owner is notified
- **WHEN** an authenticated `free`-tier user calls `POST /api/beta-access/request` with email configured
- **THEN** the response is success
- **AND** one email is sent to all `HELIO_OWNER_EMAILS` recipients identifying the requester

#### Scenario: Non-free user cannot request access
- **WHEN** an authenticated user whose tier is `beta` or `owner` calls `POST /api/beta-access/request`
- **THEN** the response is `409` with a clear message and no email is sent

### Requirement: Request-access degrades cleanly when email is unconfigured
The request-access endpoint SHALL respond `503` with a clear message, sending nothing, whenever the email
provider is not configured (missing `RESEND_API_KEY` or `HELIO_EMAIL_FROM`). A provider failure at send time
SHALL produce `502` without persisting any state change.

#### Scenario: Unconfigured email returns 503
- **WHEN** the backend runs without email configuration and a `free` user calls `POST /api/beta-access/request`
- **THEN** the response is `503` and no email is attempted

#### Scenario: Provider send failure returns 502
- **WHEN** the email provider rejects or fails the send request
- **THEN** the response is `502` and the user may retry later

### Requirement: Repeat requests are rate-limited
The system SHALL apply a best-effort per-user cooldown to request-access so repeated calls within the cooldown
window respond `429` without sending another email. The cooldown MAY reset on backend restart.

#### Scenario: Second request within the cooldown window
- **WHEN** a `free` user calls `POST /api/beta-access/request` twice within the cooldown window
- **THEN** the first call sends an email and the second responds `429` with no email sent

