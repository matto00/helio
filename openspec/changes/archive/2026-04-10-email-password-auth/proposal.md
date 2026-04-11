## Why

Helio currently has no user identity model — all resources are owned by a hardcoded `"system"` user. Email/password registration and login is the foundation of the User Authentication project; without it, no other auth capabilities (session middleware, ACL, OAuth) can be built.

## What Changes

- New `POST /api/auth/register` endpoint — creates a user with a bcrypt-hashed password
- New `POST /api/auth/login` endpoint — verifies credentials and issues a DB-backed session token
- New `POST /api/auth/logout` endpoint — invalidates the session server-side
- New `users` and `user_sessions` DB tables (Flyway migrations)
- New `UserRepository` and `AuthRoutes` following existing Slick/Akka HTTP patterns
- New `scala-bcrypt` dependency for password hashing
- Input validation: email format, password minimum 8 characters

## Capabilities

### New Capabilities

- `email-password-auth`: Registration, login, and logout endpoints with bcrypt password hashing and DB-backed session tokens

### Modified Capabilities

<!-- No existing spec-level requirements are changing -->

## Impact

- **Backend**: New Flyway migrations (V6 `users`, V7 `user_sessions`); new `UserRepository`; new `AuthRoutes`; `ApiRoutes` gains `/api/auth/` prefix; `JsonProtocols` gains auth request/response types; `build.sbt` gains `scala-bcrypt` dependency
- **Frontend**: None — this ticket is backend-only; frontend auth UI is a separate ticket (HEL-38)
- **Dependencies**: `com.github.t3hnar:scala-bcrypt_2.13` added to `build.sbt`
- **Follow-on tickets**: HEL-34 (session middleware) will use `user_sessions` to protect existing routes; HEL-35 (resource ownership) will add `owner_id` FK to `dashboards`/`panels` pointing at `users`
