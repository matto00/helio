# settings-beta-access-ui Specification

## Purpose
The tier-aware Settings section where a free user requests Beta access and redeems an invite code, with inline outcomes and an immediate no-re-login unlock of tier-gated UI on success.
## Requirements
### Requirement: Settings exposes a tier-aware Beta access section
The Settings page SHALL include a "Beta access" section. For a `free`-tier user it SHALL offer a
"Request Beta access" action and an invite-code entry field with a redeem action. For a `beta` or `owner`
user it SHALL instead confirm their current access and SHALL NOT offer request/redeem controls. The section
SHALL follow the existing Settings section patterns (shared TextField, explicit action buttons, inline
error/status presentation).

#### Scenario: Free user sees request and redeem controls
- **WHEN** a `free`-tier user opens Settings
- **THEN** the Beta access section shows a request action and a code-entry field with a redeem action

#### Scenario: Beta user sees confirmation instead of controls
- **WHEN** a `beta`- or `owner`-tier user opens Settings
- **THEN** the Beta access section confirms their access and shows no request or code-entry controls

### Requirement: Request action reports outcome inline
Triggering "Request Beta access" SHALL call the request endpoint and present its outcome inline: success
confirmation ("the owner has been notified"), or the endpoint's error (including the 503-unconfigured, 429
rate-limited, and 409-not-eligible cases) as a clear inline message. Controls SHALL be disabled while the
request is in flight.

#### Scenario: Successful request shows confirmation
- **WHEN** a free user clicks "Request Beta access" and the endpoint succeeds
- **THEN** an inline confirmation appears and the button is not left in a loading state

#### Scenario: Failed request shows the error inline
- **WHEN** the request endpoint responds with an error status
- **THEN** the error message is shown inline and the user may retry

### Requirement: Successful redemption unlocks the app without re-login
Submitting a valid code SHALL call the redeem endpoint and, on success, update the client's authenticated-user
state with the returned user object (now `tier = beta`) so tier-gated UI (chat surfaces, sidebar) unlocks
immediately — no re-login or page reload. A rejected code SHALL show the endpoint's clear error inline and
leave state unchanged.

#### Scenario: Redemption immediately unlocks chat UI
- **WHEN** a free user redeems a valid code from Settings
- **THEN** the stored current user's tier becomes `beta` and tier-locked surfaces unlock without re-login

#### Scenario: Invalid code shows a clear inline error
- **WHEN** a user submits an invalid or already-used code
- **THEN** an inline error is shown and the current user's tier remains unchanged

