## ADDED Requirements

### Requirement: Tier upgrade via invite-code redemption
The system SHALL support upgrading a user's tier from `free` to `beta` by redeeming a single-use invite code.
The upgrade SHALL be persisted on the user row in the same transaction that consumes the code and SHALL be
effective immediately for subsequent requests (tier is read fresh per request — no re-login or new session
required). Redemption SHALL never change the tier of a user whose tier is not `free`.

#### Scenario: Redemption persists the beta tier immediately
- **WHEN** a `free` user successfully redeems an invite code
- **THEN** the user row's tier is `beta` and the next tier-gated request (e.g. chat access) succeeds without
  re-authentication

#### Scenario: Redemption cannot demote an owner
- **WHEN** a user whose tier is `owner` attempts redemption
- **THEN** the request is rejected and the tier remains `owner`
