# agent-preferences-api Specification

## Purpose
`GET`/`PUT /api/preferences` on the authenticated route tree, exposing the caller's agent
preferences with get-returns-defaults / put-full-replace semantics, so the in-app agent and later
UI (420-D) can read and update a user's authoring defaults.
## Requirements
### Requirement: GET /api/preferences returns the caller's agent preferences
The backend SHALL expose `GET /api/preferences` on the authenticated route tree, returning the
caller's stored `AgentPreferences`, or an empty/default object (`defaultSeriesColors: null`,
`defaultPanelStyle: null`, `namingConventions: null`, `extras: {}`) when none is stored.

#### Scenario: Authenticated user with stored preferences
- **WHEN** a client sends `GET /api/preferences` with a valid session token
- **AND** the user has previously stored preferences
- **THEN** the response is HTTP 200 with the stored `AgentPreferences` object

#### Scenario: Authenticated user with no stored preferences
- **WHEN** a client sends `GET /api/preferences` with a valid session token
- **AND** the user has never stored preferences
- **THEN** the response is HTTP 200 with the default/empty `AgentPreferences` object

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `GET /api/preferences` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized

### Requirement: PUT /api/preferences upserts and returns the persisted object
The backend SHALL expose `PUT /api/preferences` on the authenticated route tree, accepting an
`AgentPreferences` request body, persisting it as a full replace of the caller's stored
preferences, and returning HTTP 200 with the persisted object.

#### Scenario: PUT creates preferences for a user with none stored
- **WHEN** a client sends `PUT /api/preferences` with a valid session token and a preferences body
- **AND** the user has no existing stored preferences
- **THEN** the backend persists the given preferences
- **AND** returns HTTP 200 with the persisted `AgentPreferences` object

#### Scenario: PUT fully replaces existing preferences
- **WHEN** a client sends `PUT /api/preferences` with a body omitting a previously-set field
- **AND** the user already has stored preferences with that field set
- **THEN** the persisted result reflects the new body exactly (the omitted field is cleared, not
  retained from the prior stored value)

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `PUT /api/preferences` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized

