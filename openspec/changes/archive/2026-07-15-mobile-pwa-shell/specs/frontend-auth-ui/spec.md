## MODIFIED Requirements

### Requirement: Login page
The frontend SHALL provide a `/login` page with an email/password form. Submitting the form SHALL dispatch the `login` thunk. While the thunk is pending the submit button SHALL be disabled. On success the user SHALL be redirected to `/`. On failure an inline error message SHALL be displayed. The page SHALL also render a functional "Continue with Google" button that initiates the Google OAuth flow. If on-device verification (HEL-300) determines that Google OAuth cannot complete inside an iOS standalone PWA, the Google button SHALL be hidden below the ratified phone breakpoint (430px) when the app runs in standalone display mode (via a `display-mode: standalone` media query); email/password login SHALL remain fully available in that state. Login and registration inputs SHALL keep their existing `autocomplete` attributes so iOS offers Keychain autofill.

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

#### Scenario: Google login button is visible and functional
- **WHEN** the user is on the login page in a regular browser context
- **THEN** a "Continue with Google" button is rendered and enabled
- **AND** clicking it navigates the browser to `GET /api/auth/google` (a full browser navigation, not a fetch)

#### Scenario: Standalone OAuth degradation (contingent on device test)
- **WHEN** the on-device test recorded on HEL-300 shows OAuth failing in iOS standalone mode, and the app runs in standalone display mode at a viewport at or below the phone breakpoint
- **THEN** the "Continue with Google" button is hidden and email/password login remains usable
