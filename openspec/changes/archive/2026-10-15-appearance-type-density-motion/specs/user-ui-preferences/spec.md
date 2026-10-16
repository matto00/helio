## MODIFIED Requirements

### Requirement: Partial update of the caller's preferences
`PATCH /api/users/me/preferences` SHALL accept any subset of `{contextListWidth, contextListCollapsed, typeStyle,
density, motion}`, store only the fields present, leave every other stored preference unchanged (including
`accentColor`), and return the caller's full preferences. `contextListWidth` SHALL be an integer in 200..400 and
`contextListCollapsed` a boolean. `typeStyle` SHALL be one of `"sans"`, `"mono"`, `"serif"`; `density` one of
`"comfortable"`, `"compact"`; `motion` one of `"full"`, `"subtle"`, `"off"`, or `null`, where `null` removes the saved
motion choice so the user follows the OS setting again. Any other value or unknown field SHALL be rejected with `400`
and change nothing. Unauthenticated calls SHALL get `401`. Contracts: `schemas/auth/user-preferences.schema.json` and
`schemas/auth/update-user-preferences-request.schema.json`.

#### Scenario: Partial updates accumulate
- **WHEN** the caller PATCHes `{contextListWidth: 320}` and then `{contextListCollapsed: true}`
- **THEN** the caller's preferences hold width 320, collapsed true, and the unchanged accent colour

#### Scenario: Out-of-range width rejected
- **WHEN** the caller PATCHes `{contextListWidth: 1000}`
- **THEN** the response is 400 and the stored width is unchanged

#### Scenario: Changing the accent keeps shell preferences
- **WHEN** the caller saves width 320 and then changes the accent colour via `PATCH /api/users/me/update`
- **THEN** the stored width is still 320

#### Scenario: Appearance fields are stored alongside shell fields
- **WHEN** the caller PATCHes `{typeStyle: "serif"}`, then `{density: "compact", motion: "off"}`
- **THEN** the caller's preferences hold typeStyle `serif`, density `compact`, motion `off`, and every earlier shell
  field and the accent colour unchanged

#### Scenario: Unknown appearance value rejected
- **WHEN** the caller PATCHes `{typeStyle: "comic"}` or `{density: 3}` or `{motion: "slow"}`
- **THEN** the response is 400 and no stored preference changes

#### Scenario: Clearing the motion choice
- **WHEN** a caller with saved motion `full` PATCHes `{motion: null}`
- **THEN** the returned preferences carry no `motion` and every other stored field is unchanged

### Requirement: Preferences arrive with every user-returning auth response
Every response that returns the signed-in user SHALL carry `preferences` with the shell and appearance fields:
`GET /api/auth/me`, login, register, OAuth completion, MFA verification and beta-access redemption. A field the user
never set (or set to an invalid stored value) SHALL be absent. The client SHALL therefore have the saved width,
collapsed state, type style, density and motion choice before the authenticated shell first renders, on reload and
right after sign-in, with no further request.

#### Scenario: Preferences in the login response
- **WHEN** a user who saved width 320 signs in with email and password
- **THEN** the login response's `user.preferences.contextListWidth` is 320

#### Scenario: Appearance preferences in the me response
- **WHEN** a user who saved typeStyle `serif` and density `compact` calls `GET /api/auth/me` from another device
- **THEN** `user.preferences.typeStyle` is `serif` and `user.preferences.density` is `compact`

#### Scenario: Beta redemption keeps preferences
- **WHEN** a user with saved preferences redeems a beta invite code
- **THEN** the returned user still carries those preferences and the shell keeps its width

### Requirement: Preferences are private to their user
Only the user can read or write their own preferences. The write endpoint SHALL take no user identifier and SHALL
update only the authenticated session user's record. Because `users` has no row-level security, this isolation SHALL be
proven by a test that runs against the application's non-superuser database role.

#### Scenario: Another user's PATCH cannot touch your preferences
- **WHEN** user B PATCHes `{contextListWidth: 400}` while A's stored preferences hold width 320 and an accent colour
- **THEN** A's stored preferences are byte-identical afterwards

#### Scenario: Another user's appearance PATCH cannot touch yours, through the app role
- **WHEN** user B PATCHes `{typeStyle: "mono", density: "compact", motion: "off"}` through a connection using the
  application's non-BYPASSRLS role while A has saved typeStyle `serif`
- **THEN** A's stored preferences are byte-identical afterwards and B's hold B's values
