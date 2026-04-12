## ADDED Requirements

### Requirement: Auth slice tracks current user and status
The frontend Redux store SHALL include an `authSlice` with state shape `{ currentUser: User | null, status: 'idle' | 'loading' | 'authenticated' | 'unauthenticated', token: string | null }`. The slice SHALL expose actions `setAuth`, `clearAuth`, and an async thunk `rehydrateAuth`.

#### Scenario: Initial state
- **WHEN** the Redux store is first created
- **THEN** `auth.status` is `'idle'`, `auth.currentUser` is `null`, and `auth.token` is `null`

#### Scenario: setAuth action
- **WHEN** `setAuth({ user, token })` is dispatched
- **THEN** `auth.currentUser` is set to `user`, `auth.token` is set to `token`, and `auth.status` is `'authenticated'`

#### Scenario: clearAuth action
- **WHEN** `clearAuth()` is dispatched
- **THEN** `auth.currentUser` is `null`, `auth.token` is `null`, and `auth.status` is `'unauthenticated'`

### Requirement: Login thunk
The frontend SHALL expose a `login(email, password)` async thunk that calls `POST /api/auth/login`. On success it SHALL dispatch `setAuth` with the returned user and token. On failure it SHALL return a rejected action with an error message.

#### Scenario: Successful login
- **WHEN** `login({ email, password })` is dispatched with valid credentials
- **THEN** `POST /api/auth/login` is called, `auth.status` transitions to `'authenticated'`, and `auth.currentUser` is populated

#### Scenario: Failed login
- **WHEN** `login({ email, password })` is dispatched with invalid credentials
- **THEN** the thunk rejects and `auth.status` remains `'unauthenticated'`

### Requirement: Register thunk
The frontend SHALL expose a `register(email, password, displayName?)` async thunk that calls `POST /api/auth/register`. On success it SHALL dispatch `setAuth` and transition to `authenticated`. On failure it SHALL return a rejected action with an error message.

#### Scenario: Successful registration
- **WHEN** `register({ email, password })` is dispatched with valid data
- **THEN** `POST /api/auth/register` is called, `auth.status` transitions to `'authenticated'`, and `auth.currentUser` is populated

#### Scenario: Duplicate email
- **WHEN** `register({ email, password })` is dispatched with an already-registered email
- **THEN** the thunk rejects with a message indicating the email is already in use

### Requirement: Logout thunk
The frontend SHALL expose a `logout()` async thunk that calls `POST /api/auth/logout` with the current token. On completion (success or failure) it SHALL dispatch `clearAuth` and remove the token from `sessionStorage`.

#### Scenario: Successful logout
- **WHEN** `logout()` is dispatched while authenticated
- **THEN** `POST /api/auth/logout` is called, `clearAuth` is dispatched, and `auth.status` becomes `'unauthenticated'`

#### Scenario: Logout clears token even on network error
- **WHEN** `logout()` is dispatched and the network request fails
- **THEN** `clearAuth` is still dispatched and the local session is cleared

### Requirement: Session rehydration on app load
The frontend SHALL expose a `rehydrateAuth()` async thunk. On app mount, the application SHALL dispatch `rehydrateAuth()`. The thunk SHALL read the token from `sessionStorage`; if present it SHALL call `GET /api/auth/me` with the token. On a `200 OK` response it SHALL dispatch `setAuth`. On any other response or if no token exists it SHALL dispatch `clearAuth`.

#### Scenario: Valid token in sessionStorage
- **WHEN** `rehydrateAuth()` is dispatched and `sessionStorage` contains a valid token
- **THEN** `GET /api/auth/me` is called, `auth.status` becomes `'authenticated'`, and `auth.currentUser` is populated

#### Scenario: Expired or invalid token in sessionStorage
- **WHEN** `rehydrateAuth()` is dispatched and the token in `sessionStorage` is expired or unrecognised
- **THEN** `GET /api/auth/me` returns `401`, `clearAuth` is dispatched, and `auth.status` becomes `'unauthenticated'`

#### Scenario: No token in sessionStorage
- **WHEN** `rehydrateAuth()` is dispatched and `sessionStorage` has no token
- **THEN** `clearAuth` is dispatched immediately without calling the server and `auth.status` becomes `'unauthenticated'`

### Requirement: Token persisted to sessionStorage
The frontend SHALL write the bearer token to `sessionStorage` under the key `helio_auth_token` whenever `setAuth` is dispatched, and SHALL remove it whenever `clearAuth` is dispatched.

#### Scenario: Token written on login
- **WHEN** `setAuth` is dispatched with a token
- **THEN** `sessionStorage.getItem('helio_auth_token')` returns that token

#### Scenario: Token removed on logout
- **WHEN** `clearAuth` is dispatched
- **THEN** `sessionStorage.getItem('helio_auth_token')` returns `null`

### Requirement: Bearer token attached to all API requests
The frontend SHALL set `Authorization: Bearer <token>` as a default header on the shared Axios `httpClient` instance whenever `setAuth` is dispatched, and SHALL remove that header whenever `clearAuth` is dispatched.

#### Scenario: Header present after login
- **WHEN** the user successfully logs in
- **THEN** all subsequent HTTP requests made via `httpClient` include `Authorization: Bearer <token>`

#### Scenario: Header removed after logout
- **WHEN** the user logs out
- **THEN** subsequent HTTP requests via `httpClient` do NOT include an `Authorization` header
