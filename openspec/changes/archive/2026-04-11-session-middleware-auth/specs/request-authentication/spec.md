## ADDED Requirements

### Requirement: Protected routes require a valid Bearer token
All `/api/dashboards` and `/api/panels` routes SHALL require an `Authorization: Bearer <token>` header. The token MUST exist in the `user_sessions` table and MUST NOT be expired. Requests that fail this check SHALL be rejected before the route handler executes.

#### Scenario: Valid token grants access
- **WHEN** a request includes `Authorization: Bearer <valid-token>` where the token exists in `user_sessions` and has not expired
- **THEN** the route handler executes normally and returns the expected response

#### Scenario: Missing Authorization header returns 401
- **WHEN** a request to a protected route has no `Authorization` header
- **THEN** the server responds with `401 Unauthorized`
- **THEN** the response body is `{"error": "Unauthorized"}`

#### Scenario: Malformed Authorization header returns 401
- **WHEN** a request includes an `Authorization` header that does not start with `Bearer `
- **THEN** the server responds with `401 Unauthorized`
- **THEN** the response body is `{"error": "Unauthorized"}`

#### Scenario: Unknown token returns 401
- **WHEN** a request includes `Authorization: Bearer <token>` where the token does not exist in `user_sessions`
- **THEN** the server responds with `401 Unauthorized`
- **THEN** the response body is `{"error": "Unauthorized"}`

#### Scenario: Expired token returns 401
- **WHEN** a request includes `Authorization: Bearer <token>` where the token exists in `user_sessions` but `expires_at` is in the past
- **THEN** the server responds with `401 Unauthorized`
- **THEN** the response body is `{"error": "Unauthorized"}`

### Requirement: Auth and health routes remain public
The `/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, and `/health` routes SHALL NOT require authentication.

#### Scenario: Register is accessible without a token
- **WHEN** a request is made to `POST /api/auth/register` without an `Authorization` header
- **THEN** the request is processed normally (not rejected with 401)

#### Scenario: Login is accessible without a token
- **WHEN** a request is made to `POST /api/auth/login` without an `Authorization` header
- **THEN** the request is processed normally (not rejected with 401)

#### Scenario: Health check is accessible without a token
- **WHEN** a request is made to `GET /health` without an `Authorization` header
- **THEN** the server responds with `200 OK`
