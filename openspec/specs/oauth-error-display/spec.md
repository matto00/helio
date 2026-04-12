## ADDED Requirements

### Requirement: Login page reads error query parameter
The `LoginPage` component SHALL read the `error` query parameter from the current URL on mount. If `error=oauth_failed` is present, the component SHALL render a user-friendly error message without requiring any user interaction.

#### Scenario: Error message shown for oauth_failed
- **WHEN** the user is navigated to `/login?error=oauth_failed`
- **THEN** the login page renders the message "Google sign-in failed. Please try again." (or equivalent human-readable text)
- **AND** the email/password form is still visible and usable

#### Scenario: No error message when no query param
- **WHEN** the user navigates to `/login` with no query parameters
- **THEN** no error message is displayed

#### Scenario: Error message absent after successful login
- **WHEN** the user successfully completes email/password login after arriving via `/login?error=oauth_failed`
- **THEN** they are redirected to `/` and the error message is no longer visible
