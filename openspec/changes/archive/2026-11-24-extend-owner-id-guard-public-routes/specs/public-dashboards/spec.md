## MODIFIED Requirements

### Requirement: Every public route response is free of the owner's user id
No response from a route reachable without authentication or via optional authentication SHALL contain a key or value
containing an owner's user id for a non-owner caller. This covers: the public panel list, rows, filter-capabilities,
distinct-values, output-meta, provenance, history and insight routes; the image upload fetch; connector completion
(GET and POST); `/health`; and the error bodies of the `/api/auth/*` routes (register, login, Google OAuth callback, MFA verify) plus the
Google OAuth start redirect's `Location` header. Success bodies of register, login, the OAuth callback and MFA verify
are excluded, since they return the caller's own identity.

#### Scenario: Generic guard
- **WHEN** each public route is called anonymously against a fixture whose owner id is a distinctive value
- **THEN** a recursive walk of the response JSON finds no key or string containing that owner id

#### Scenario: Auth error bodies for the owner's own email
- **WHEN** an anonymous caller logs in with a wrong password, or registers again, using the owner's email (exact
  case or a case variant), or verifies MFA with a bad challenge, or calls the OAuth callback with a bad state
- **THEN** the error body contains no key or string containing the owner's user id
