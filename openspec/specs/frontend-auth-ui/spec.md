## ADDED Requirements

### Requirement: Login page
The frontend SHALL provide a `/login` page with an email/password form. Submitting the form SHALL dispatch the `login` thunk. While the thunk is pending the submit button SHALL be disabled. On success the user SHALL be redirected to `/`. On failure an inline error message SHALL be displayed.

#### Scenario: Successful login redirects to home
- **WHEN** the user submits valid credentials on the login page
- **THEN** the app navigates to `/` and the main dashboard view is shown

#### Scenario: Failed login shows error message
- **WHEN** the user submits incorrect credentials on the login page
- **THEN** an inline error message is displayed and the user remains on `/login`

#### Scenario: Submit button disabled while loading
- **WHEN** the login form has been submitted and the request is in flight
- **THEN** the submit button is disabled to prevent duplicate submissions

#### Scenario: Link to registration page
- **WHEN** the user is on the login page
- **THEN** a link to `/register` is visible

#### Scenario: Google login button is visible but non-functional
- **WHEN** the user is on the login page
- **THEN** a "Continue with Google" button is rendered
- **AND** clicking it does NOT initiate any OAuth flow in this version

### Requirement: Registration page
The frontend SHALL provide a `/register` page with email, password, and optional display name fields. Submitting the form SHALL dispatch the `register` thunk. On success the user SHALL be redirected to `/`. On failure an inline error message SHALL be displayed.

#### Scenario: Successful registration redirects to home
- **WHEN** the user submits valid registration data
- **THEN** the app navigates to `/` and the main dashboard view is shown

#### Scenario: Duplicate email shows error
- **WHEN** the user submits a registration form with an already-registered email
- **THEN** an inline error message is displayed indicating the email is taken

#### Scenario: Password validation
- **WHEN** the user submits a registration form with a password shorter than 8 characters
- **THEN** an inline error message is displayed before the form is submitted to the server

#### Scenario: Link to login page
- **WHEN** the user is on the registration page
- **THEN** a link to `/login` is visible

### Requirement: Logout button in app header
The app header SHALL include a logout button when `auth.status` is `'authenticated'`. Clicking it SHALL dispatch the `logout` thunk. On completion the user SHALL be redirected to `/login`.

#### Scenario: Logout button visible when authenticated
- **WHEN** `auth.status` is `'authenticated'`
- **THEN** a logout button is visible in the app header

#### Scenario: Clicking logout clears session and redirects
- **WHEN** the user clicks the logout button
- **THEN** the `logout` thunk is dispatched, auth state is cleared, and the user is redirected to `/login`

### Requirement: Global 401 handling redirects to login
The frontend SHALL intercept all `401 Unauthorized` HTTP responses via an Axios response interceptor. On receiving a 401 the interceptor SHALL dispatch `clearAuth` and redirect the user to `/login`. The interceptor SHALL NOT redirect if the 401 came from `GET /api/auth/me` during rehydration (to avoid a loop).

#### Scenario: 401 from protected API call redirects to login
- **WHEN** any API call returns `401 Unauthorized` during normal app use
- **THEN** `clearAuth` is dispatched, the session is cleared, and the user is redirected to `/login`

#### Scenario: 401 during rehydration does not cause a redirect loop
- **WHEN** `GET /api/auth/me` returns `401` during initial rehydration
- **THEN** `clearAuth` is dispatched and the user is redirected to `/login` only once, without a navigation loop
