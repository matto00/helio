## MODIFIED Requirements

### Requirement: Workspace accent color persists to backend when authenticated
The system SHALL persist the selected accent color to the backend via `PATCH /api/users/me/update`
when the user is authenticated, in addition to (not instead of) writing to localStorage.

#### Scenario: Accent color change dispatches updateUserPreferences when authenticated
- **WHEN** the user selects an accent color and is authenticated
- **THEN** `updateUserPreferences` is dispatched with `{ fields: ["accentColor"], user: { accentColor: "<color>" } }`
- **AND** localStorage is also updated as a fast-restore fallback

#### Scenario: Accent color change does not dispatch when unauthenticated
- **WHEN** the user selects an accent color and is not authenticated
- **THEN** only localStorage is updated (no network request)

## ADDED Requirements

### Requirement: Accent color is restored from backend on app load
The system SHALL restore the accent color from `GET /api/auth/me` preferences on app load (after
authentication resolves), falling back to localStorage and then the default if the backend has no saved value.

#### Scenario: Backend preference takes precedence on load
- **WHEN** the app completes authentication (rehydrateAuth, login, or register resolves)
- **AND** the returned user object has `preferences.accentColor = "#3b82f6"`
- **THEN** the accent color is updated to `"#3b82f6"` regardless of what is in localStorage

#### Scenario: localStorage fallback when backend has no accent color
- **WHEN** the app completes authentication
- **AND** the user has no saved `accentColor` in backend preferences
- **AND** localStorage has a stored accent color
- **THEN** the stored localStorage value is used (no change in behavior from before)

#### Scenario: Default when neither backend nor localStorage has a color
- **WHEN** the app completes authentication
- **AND** neither backend preferences nor localStorage has a saved accent color
- **THEN** the accent color defaults to `"#f97316"` (orange)
