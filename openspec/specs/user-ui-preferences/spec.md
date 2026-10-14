# user-ui-preferences Specification

## Purpose
Per-user UI preferences stored server-side in the user's existing preferences record, so the shell renders the same
way on every device from the first paint. It starts with the context list's width and collapsed state; later appearance
settings (HEL-1572) add fields to the same record.

## Requirements

### Requirement: Partial update of the caller's preferences
`PATCH /api/users/me/preferences` SHALL accept any subset of `{contextListWidth, contextListCollapsed}`, store only the
fields present, leave every other stored preference unchanged (including `accentColor`), and return the caller's full
preferences. `contextListWidth` SHALL be an integer in 200..400 and `contextListCollapsed` a boolean; any other value
or unknown field SHALL be rejected with `400` and change nothing. Unauthenticated calls SHALL get `401`. Contracts:
`schemas/auth/user-preferences.schema.json` and `schemas/auth/update-user-preferences-request.schema.json`.

#### Scenario: Partial updates accumulate
- **WHEN** the caller PATCHes `{contextListWidth: 320}` and then `{contextListCollapsed: true}`
- **THEN** the caller's preferences hold width 320, collapsed true, and the unchanged accent colour

#### Scenario: Out-of-range width rejected
- **WHEN** the caller PATCHes `{contextListWidth: 1000}`
- **THEN** the response is 400 and the stored width is unchanged

#### Scenario: Changing the accent keeps shell preferences
- **WHEN** the caller saves width 320 and then changes the accent colour via `PATCH /api/users/me/update`
- **THEN** the stored width is still 320

### Requirement: Preferences arrive with every user-returning auth response
Every response that returns the signed-in user SHALL carry `preferences` with the shell fields: `GET /api/auth/me`,
login, register, OAuth completion, MFA verification and beta-access redemption. The client SHALL therefore have the
saved width and collapsed state before the authenticated shell first renders, on reload and right after sign-in, with
no further request.

#### Scenario: Preferences in the login response
- **WHEN** a user who saved width 320 signs in with email and password
- **THEN** the login response's `user.preferences.contextListWidth` is 320

#### Scenario: Beta redemption keeps preferences
- **WHEN** a user with saved preferences redeems a beta invite code
- **THEN** the returned user still carries those preferences and the shell keeps its width

### Requirement: Preferences are private to their user
Only the user can read or write their own preferences. The write endpoint SHALL take no user identifier and SHALL
update only the authenticated session user's record.

#### Scenario: Another user's PATCH cannot touch your preferences
- **WHEN** user B PATCHes `{contextListWidth: 400}` while A's stored preferences hold width 320 and an accent colour
- **THEN** A's stored preferences are byte-identical afterwards
