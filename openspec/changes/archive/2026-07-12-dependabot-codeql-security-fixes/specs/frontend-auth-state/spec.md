## MODIFIED Requirements

### Requirement: Auth slice tracks current user and status
The frontend Redux store SHALL include an `authSlice` with state shape `{ currentUser: User | null,
status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated' }`. There SHALL be no `token` field —
the session credential lives exclusively in an `HttpOnly` cookie managed by the backend and is never
readable by frontend JavaScript. The slice SHALL expose actions `setAuth`, `clearAuth`, and async
thunks `rehydrateAuth` and `handleOAuthCallback`. The `User` type SHALL include
`avatarUrl: string | null` in addition to `id`, `email`, `displayName`, and `createdAt`.

#### Scenario: Initial state
- **WHEN** the Redux store is first created
- **THEN** `auth.status` is `'idle'` and `auth.currentUser` is `null`

#### Scenario: setAuth action
- **WHEN** `setAuth({ user })` is dispatched
- **THEN** `auth.currentUser` is set to `user` and `auth.status` is `'authenticated'`

#### Scenario: clearAuth action
- **WHEN** `clearAuth()` is dispatched
- **THEN** `auth.currentUser` is `null` and `auth.status` is `'unauthenticated'`

### Requirement: Login thunk
The frontend SHALL expose a `login(email, password)` async thunk that calls `POST /api/auth/login`
with `withCredentials: true`. On success (the backend sets the session cookie via `Set-Cookie`) it
SHALL dispatch `setAuth` with the returned user. On failure it SHALL return a rejected action with an
error message.

#### Scenario: Successful login
- **WHEN** `login({ email, password })` is dispatched with valid credentials
- **THEN** `POST /api/auth/login` is called with credentials included, `auth.status` transitions to
  `'authenticated'`, and `auth.currentUser` is populated
- **AND** the response body contains no `token` field

#### Scenario: Failed login
- **WHEN** `login({ email, password })` is dispatched with invalid credentials
- **THEN** the thunk rejects and `auth.status` remains `'unauthenticated'`

### Requirement: Logout thunk
The frontend SHALL expose a `logout()` async thunk that calls `POST /api/auth/logout` with
`withCredentials: true` (no token argument — the session cookie identifies the session). On
completion (success or failure) it SHALL dispatch `clearAuth`.

#### Scenario: Successful logout
- **WHEN** `logout()` is dispatched while authenticated
- **THEN** `POST /api/auth/logout` is called with credentials included, `clearAuth` is dispatched, and
  `auth.status` becomes `'unauthenticated'`

#### Scenario: Logout clears state even on network error
- **WHEN** `logout()` is dispatched and the network request fails
- **THEN** `clearAuth` is still dispatched and the local session state is cleared

### Requirement: Session rehydration on app load
The frontend SHALL expose a `rehydrateAuth()` async thunk. On app mount, the application SHALL
dispatch `rehydrateAuth()`, which SHALL call `GET /api/auth/me` with `withCredentials: true` (the
browser attaches the session cookie automatically; there is no client-side check for a stored token).
On a `200 OK` response it SHALL dispatch `setAuth`. On any other response it SHALL dispatch
`clearAuth`.

#### Scenario: Valid session cookie present
- **WHEN** `rehydrateAuth()` is dispatched and the browser holds a valid `helio_session` cookie
- **THEN** `GET /api/auth/me` is called, `auth.status` becomes `'authenticated'`, and `auth.currentUser`
  is populated

#### Scenario: No or invalid session cookie
- **WHEN** `rehydrateAuth()` is dispatched and the browser has no `helio_session` cookie, or it is
  expired/unrecognised
- **THEN** `GET /api/auth/me` returns `401`, `clearAuth` is dispatched, and `auth.status` becomes
  `'unauthenticated'`

### Requirement: handleOAuthCallback thunk
The frontend SHALL expose a `handleOAuthCallback(code: string, state?: string)` async thunk that calls
`GET /api/auth/google/callback` with `withCredentials: true` and the provided `code`/optional `state`
query parameters. On `200 OK` (the backend sets the session cookie via `Set-Cookie`) it SHALL dispatch
`setAuth({ user })`. On failure it SHALL return a rejected action.

#### Scenario: Successful OAuth callback exchange
- **WHEN** `handleOAuthCallback({ code: "valid-code" })` is dispatched
- **THEN** `GET /api/auth/google/callback?code=valid-code` is called with credentials included
- **AND** on success `auth.status` becomes `'authenticated'` and `auth.currentUser` is populated with
  `avatarUrl`
- **AND** the response body contains no `token` field

#### Scenario: Failed OAuth callback exchange
- **WHEN** `handleOAuthCallback({ code: "expired-code" })` is dispatched and the backend returns an
  error
- **THEN** the thunk rejects and `auth.status` remains `'unauthenticated'`

## ADDED Requirements

### Requirement: No client-side persistence of the session credential
The frontend SHALL NOT store the session token in `sessionStorage`, `localStorage`, or any other
JavaScript-readable storage, and SHALL NOT set a manual `Authorization` header for session auth. The
shared Axios `httpClient` instance SHALL be configured with `withCredentials: true` so the browser
manages cookie attachment.

#### Scenario: Nothing written to sessionStorage on login
- **WHEN** `setAuth` is dispatched after a successful login, register, or OAuth callback
- **THEN** `sessionStorage.getItem('helio_auth_token')` (and any equivalent key) returns `null`

#### Scenario: No Authorization header set for session auth
- **WHEN** the user successfully logs in
- **THEN** subsequent HTTP requests via `httpClient` do NOT carry a manually-set
  `Authorization: Bearer` header for session identity (the session cookie is attached automatically by
  the browser via `withCredentials`)

## REMOVED Requirements

### Requirement: Token persisted to sessionStorage
**Reason**: Replaced by the httpOnly session-cookie design (CodeQL alert #8 — clear-text storage of
the session token in `sessionStorage`). The token must never be readable by frontend JavaScript.
**Migration**: No client-side migration needed — HEL-288's `V45` migration already deleted all live
sessions, so no stale `sessionStorage` entries need to be honored. Any existing entry is simply
ignored (the backend no longer accepts it) and is naturally cleared on next logout/login.

### Requirement: Bearer token attached to all API requests
**Reason**: Session identity now travels via the `HttpOnly` cookie, not a manually-set `Authorization`
header. Keeping a JS-readable copy of the token to build this header was the vulnerability being
fixed.
**Migration**: `httpClient` sets `withCredentials: true` instead; no caller-visible change beyond that
(Personal Access Token flows, which are unrelated to `authSlice`, are unaffected).
