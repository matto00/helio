## MODIFIED Requirements

### Requirement: PATCH /api/users/me/update endpoint exists
The backend MUST expose a `PATCH /api/users/me/update` endpoint that accepts a user preference
payload, persists the specified fields to the database, and returns HTTP 200 OK with the updated
preferences object. The authenticated user's identity is derived from the session token — no `:id`
path parameter is required.

#### Scenario: User preference update with zoomLevel returns 200 and updated prefs
- **WHEN** a client sends `PATCH /api/users/me/update` with `{ "fields": ["zoomLevel"], "user": { "zoomLevel": 1.25, "dashboardId": "<id>" } }`
- **THEN** the backend persists the zoom level for that dashboard
- **AND** returns HTTP 200 with `{ "preferences": { "accentColor": <current>, "zoomLevels": { "<id>": 1.25 } } }`

#### Scenario: User preference update with accentColor returns 200 and updated prefs
- **WHEN** a client sends `PATCH /api/users/me/update` with `{ "fields": ["accentColor"], "user": { "accentColor": "#f97316" } }`
- **THEN** the backend persists the accent color in the user's global preferences
- **AND** returns HTTP 200 with `{ "preferences": { "accentColor": "#f97316", "zoomLevels": <current> } }`

#### Scenario: Partial fields update only specified fields
- **WHEN** a client sends `PATCH /api/users/me/update` with `{ "fields": ["accentColor"], "user": { "accentColor": "#3b82f6", "zoomLevel": 1.5 } }`
- **THEN** only `accentColor` is updated (zoomLevel is ignored because it is not in the `fields` list)

#### Scenario: Unauthenticated request is rejected
- **WHEN** a client sends `PATCH /api/users/me/update` without a valid session token
- **THEN** the backend returns HTTP 401 Unauthorized

## REMOVED Requirements

### Requirement: User preference update is a noop on the backend
**Reason**: The user_preferences table now exists (V18 migration) and the endpoint fully persists data.
**Migration**: Use `PATCH /api/users/me/update` which now returns 200 with updated preferences.
