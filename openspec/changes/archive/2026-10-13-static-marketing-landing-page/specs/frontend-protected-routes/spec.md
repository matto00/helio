## MODIFIED Requirements

### Requirement: App routes wrapped with ProtectedRoute
All existing application routes (`/home`, `/sources`, `/pipelines`, and `/pipelines/:id`) SHALL be nested inside `ProtectedRoute`. The `/login` and `/register` routes SHALL remain outside `ProtectedRoute` (public).

#### Scenario: Dashboard route is protected
- **WHEN** an unauthenticated user navigates to `/home`
- **THEN** they are redirected to `/login`

#### Scenario: Sources route is protected
- **WHEN** an unauthenticated user navigates to `/sources`
- **THEN** they are redirected to `/login`

#### Scenario: Login route is public
- **WHEN** an unauthenticated user navigates to `/login`
- **THEN** the login page is rendered without a redirect

#### Scenario: Register route is public
- **WHEN** an unauthenticated user navigates to `/register`
- **THEN** the registration page is rendered without a redirect

#### Scenario: Pipelines list route is protected
- **WHEN** an unauthenticated user navigates to `/pipelines`
- **THEN** they are redirected to `/login`

#### Scenario: Pipeline detail route is protected
- **WHEN** an unauthenticated user navigates to `/pipelines/:id`
- **THEN** they are redirected to `/login`

### Requirement: Already-authenticated users are not shown login/register pages
When `auth.status` is `'authenticated'`, navigating to `/login` or `/register` SHALL redirect the user to `/home`.

#### Scenario: Authenticated user visits /login
- **WHEN** `auth.status` is `'authenticated'` and the user navigates to `/login`
- **THEN** the browser is redirected to `/home`
