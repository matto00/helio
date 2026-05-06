## ADDED Requirements

### Requirement: ProtectedRoute guards authenticated-only pages
The frontend SHALL provide a `ProtectedRoute` component that wraps React Router routes. It SHALL render its children (via `<Outlet />`) only when `auth.status` is `'authenticated'`. When `auth.status` is `'idle'` or `'loading'` it SHALL render a loading indicator. When `auth.status` is `'unauthenticated'` it SHALL render `<Navigate to="/login" replace />`.

#### Scenario: Authenticated user sees protected content
- **WHEN** `auth.status` is `'authenticated'` and the user navigates to a protected route
- **THEN** the route's content is rendered normally

#### Scenario: Unauthenticated user is redirected to login
- **WHEN** `auth.status` is `'unauthenticated'` and the user navigates to a protected route
- **THEN** the browser is redirected to `/login` with `replace` so the protected path is not added to history

#### Scenario: Auth rehydration in progress shows loading
- **WHEN** `auth.status` is `'idle'` or `'loading'` and the user navigates to a protected route
- **THEN** a loading indicator is shown and no redirect occurs until the status resolves

### Requirement: App routes wrapped with ProtectedRoute
All existing application routes (`/` and `/sources`) SHALL be nested inside `ProtectedRoute`. The `/login` and `/register` routes SHALL remain outside `ProtectedRoute` (public).

#### Scenario: Dashboard route is protected
- **WHEN** an unauthenticated user navigates to `/`
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

### Requirement: Pipelines route is protected
The `/pipelines` route SHALL be nested inside `ProtectedRoute`. An unauthenticated user navigating
to `/pipelines` SHALL be redirected to `/login`.

#### Scenario: Pipelines route is protected
- **WHEN** an unauthenticated user navigates to `/pipelines`
- **THEN** they are redirected to `/login`

### Requirement: Already-authenticated users are not shown login/register pages
When `auth.status` is `'authenticated'`, navigating to `/login` or `/register` SHALL redirect the user to `/`.

#### Scenario: Authenticated user visits /login
- **WHEN** `auth.status` is `'authenticated'` and the user navigates to `/login`
- **THEN** the browser is redirected to `/`
