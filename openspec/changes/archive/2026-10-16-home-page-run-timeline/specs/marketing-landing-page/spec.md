## MODIFIED Requirements

### Requirement: App home lives at /home
The app's home view, the Home page (HEL-1578), SHALL be served at `/home`; the dashboard view is served at
`/dashboards`. An in-app client-side navigation to `/` SHALL redirect to `/home`. Every in-app link, button or redirect
whose destination is "app home" SHALL target `/home`.

#### Scenario: Signed-in user opens /home
- **WHEN** an authenticated user navigates to `/home`
- **THEN** the Home page renders

#### Scenario: Wordmark goes home
- **WHEN** an authenticated user clicks the app's wordmark
- **THEN** the app navigates to `/home`
