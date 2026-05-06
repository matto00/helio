## ADDED Requirements

### Requirement: Pipelines route is protected
The `/pipelines` route SHALL be nested inside `ProtectedRoute`. An unauthenticated user navigating
to `/pipelines` SHALL be redirected to `/login`.

#### Scenario: Pipelines route is protected
- **WHEN** an unauthenticated user navigates to `/pipelines`
- **THEN** they are redirected to `/login`
