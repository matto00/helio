## ADDED Requirements

### Requirement: Mutating requests authenticated via session cookie require a custom header
The system SHALL require the header `X-Helio-Requested-With: 1` on every non-`GET` request under `/api/*` whose identity resolves from the `HttpOnly` session cookie (`helio_session`). Requests missing this header SHALL be rejected with `403 Forbidden` before the route handler executes. This is the primary CSRF defense: a cross-site page cannot attach a custom header to a request without triggering a CORS preflight, which the existing origin allowlist (`corsAllowedOrigins`) rejects for any origin not explicitly configured.

#### Scenario: Mutating request with the header succeeds
- **WHEN** a `POST /api/panels` request is made with a valid `helio_session` cookie and
  `X-Helio-Requested-With: 1`
- **THEN** the request is processed normally

#### Scenario: Mutating request missing the header is rejected
- **WHEN** a `POST /api/panels` request is made with a valid `helio_session` cookie but no
  `X-Helio-Requested-With` header
- **THEN** the system returns `403 Forbidden`

#### Scenario: GET requests are exempt
- **WHEN** a `GET /api/dashboards` request is made with a valid `helio_session` cookie and no
  `X-Helio-Requested-With` header
- **THEN** the request is processed normally (idempotent reads are not CSRF targets)

#### Scenario: PAT-authenticated requests are exempt
- **WHEN** a `POST /api/panels` request is made with `Authorization: Bearer helio_pat_<valid-token>`
  and no `X-Helio-Requested-With` header
- **THEN** the request is processed normally (PATs are deliberately attached by non-browser clients,
  not ambient browser credentials, so they are not subject to cross-site request forgery)

### Requirement: Frontend attaches the CSRF header by default
The shared Axios `httpClient` instance SHALL set `X-Helio-Requested-With: 1` as a default header on all requests.

#### Scenario: Header present on every request
- **WHEN** any request is made via `httpClient`, mutating or not
- **THEN** the request includes `X-Helio-Requested-With: 1`
