## ADDED Requirements

### Requirement: OAuth callback route exists outside protected routes
The frontend SHALL expose a `/auth/callback` route that is publicly accessible (not wrapped by `ProtectedRoute`). This route SHALL render the `OAuthCallbackPage` component.

#### Scenario: Callback route is reachable without authentication
- **WHEN** an unauthenticated browser navigates to `/auth/callback?code=abc123`
- **THEN** the `OAuthCallbackPage` component is rendered (not redirected to `/login`)

### Requirement: OAuthCallbackPage exchanges code with backend
When `OAuthCallbackPage` mounts and a `code` query parameter is present, the component SHALL call `GET /api/auth/google/callback` with the `code` (and `state` if present) forwarded as query parameters via the axios http client.

#### Scenario: Successful code exchange
- **WHEN** the browser lands on `/auth/callback?code=valid-code`
- **THEN** the component calls `GET /api/auth/google/callback?code=valid-code` via axios
- **AND** on a `200 OK` response dispatches `setAuth({ token, user })` and navigates to `/`

#### Scenario: Code is exchanged only once per mount
- **WHEN** the component mounts in React 18 StrictMode (which double-invokes effects)
- **THEN** `GET /api/auth/google/callback` is called exactly once for a given code value

### Requirement: OAuthCallbackPage handles OAuth error parameter
If the browser lands on `/auth/callback?error=<value>` (Google issued an error instead of a code), the component SHALL immediately navigate to `/login?error=oauth_failed` without calling the backend.

#### Scenario: Google returns error on callback
- **WHEN** the browser lands on `/auth/callback?error=access_denied`
- **THEN** no backend call is made and the user is navigated to `/login?error=oauth_failed`

### Requirement: OAuthCallbackPage handles backend exchange failure
If the `GET /api/auth/google/callback` call returns a non-2xx response, the component SHALL navigate to `/login?error=oauth_failed`.

#### Scenario: Backend returns error during exchange
- **WHEN** `GET /api/auth/google/callback?code=…` returns a 4xx or 5xx response
- **THEN** the user is navigated to `/login?error=oauth_failed`

### Requirement: OAuthCallbackPage displays a loading indicator
While the code exchange is in progress, the component SHALL render a visible loading state (e.g. "Signing in…" text) and SHALL NOT render an error or redirect prematurely.

#### Scenario: Loading state while exchange is pending
- **WHEN** the component is mounted and the backend call is in flight
- **THEN** a loading indicator is visible and the user has not been redirected
