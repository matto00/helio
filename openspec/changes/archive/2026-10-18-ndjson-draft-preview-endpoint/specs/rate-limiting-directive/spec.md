## ADDED Requirements

### Requirement: A route with its own limiter can be exempted from a directive
The rate-limiting directive SHALL accept an exemption predicate over the request. An exempt request SHALL pass through without
touching that directive's bucket. The general `/api` directive SHALL exempt exactly `POST /api/pipelines/:id/draft-preview`
(the same path the route matches); any other method or path variant SHALL still be counted.

#### Scenario: Exempt route
- **WHEN** a principal sends draft-preview requests
- **THEN** the general `/api` bucket for that principal is unchanged

#### Scenario: Near-miss path is still counted
- **WHEN** a principal sends `GET /api/pipelines/x/draft-preview` or a `POST` with a trailing slash
- **THEN** the general bucket is decremented
