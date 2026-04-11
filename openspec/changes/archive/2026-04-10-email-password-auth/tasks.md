## 1. Build & Dependencies

- [ ] 1.1 Add `"com.github.t3hnar" %% "scala-bcrypt" % "4.3.0"` to `libraryDependencies` in `backend/build.sbt`

## 2. Database Migrations

- [ ] 2.1 Create `backend/src/main/resources/db/migration/V6__users.sql` — `users` table:
  ```sql
  CREATE TABLE users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email        TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    display_name TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- [ ] 2.2 Create `backend/src/main/resources/db/migration/V7__user_sessions.sql` — `user_sessions` table:
  ```sql
  CREATE TABLE user_sessions (
    token      TEXT PRIMARY KEY,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  ```

## 3. Domain Model

- [ ] 3.1 Add to `backend/src/main/scala/com/helio/domain/model.scala`:
  - `final case class UserId(value: String) extends AnyVal`
  - `final case class User(id: UserId, email: String, displayName: Option[String], createdAt: java.time.Instant)`
  - `final case class UserSession(token: String, userId: UserId, createdAt: java.time.Instant, expiresAt: java.time.Instant)`

## 4. UserRepository

- [ ] 4.1 Create `backend/src/main/scala/com/helio/infrastructure/UserRepository.scala` following the DashboardRepository Slick pattern:
  - Inner `UserRow` case class and `UserTable` (Slick table mapping `users`)
  - Inner `SessionRow` case class and `SessionTable` (Slick table mapping `user_sessions`)
  - `findByEmail(email: String): Future[Option[User]]`
  - `insert(user: User, passwordHash: String): Future[User]` — stores hash in `password_hash` column, never in domain
  - `getPasswordHash(userId: UserId): Future[Option[String]]` — used by login to retrieve hash for verification
  - `createSession(session: UserSession): Future[UserSession]`
  - `findSession(token: String): Future[Option[UserSession]]`
  - `deleteSession(token: String): Future[Unit]`

## 5. JSON Protocols

- [ ] 5.1 Add to `backend/src/main/scala/com/helio/api/JsonProtocols.scala`:
  - `final case class RegisterRequest(email: String, password: String, displayName: Option[String])`
  - `final case class LoginRequest(email: String, password: String)`
  - `final case class UserResponse(id: String, email: String, displayName: Option[String], createdAt: String)`
  - `final case class AuthResponse(token: String, expiresAt: String, user: UserResponse)`
  - Spray JSON implicit formats for all four types

## 6. Request Validation

- [ ] 6.1 Add to `backend/src/main/scala/com/helio/api/RequestValidation.scala` (or equivalent validation helper):
  - `validateRegisterRequest(req: RegisterRequest): Either[String, RegisterRequest]` — checks email regex (`^[^@]+@[^@]+\.[^@]+$`) and `password.length >= 8`
  - `validateLoginRequest(req: LoginRequest): Either[String, LoginRequest]` — checks email and password non-empty

## 7. AuthRoutes

- [ ] 7.1 Create `backend/src/main/scala/com/helio/api/routes/AuthRoutes.scala` following the DashboardRoutes Akka HTTP pattern, injecting `UserRepository` and `implicit ec`:
  - `POST /register`:
    1. Validate request via `validateRegisterRequest` → `400` on failure
    2. Check `userRepo.findByEmail(email)` → `409 Conflict` if exists
    3. Hash password: `password.bcryptBounded(12)`
    4. Insert user, create 30-day session (token = 64-char hex from `SecureRandom`)
    5. Return `201 Created` with `AuthResponse`
  - `POST /login`:
    1. Validate request → `400` on failure
    2. `userRepo.findByEmail(email)` — if `None`, run dummy `BCrypt.checkpw` to equalise timing, return `401`
    3. `userRepo.getPasswordHash(userId)`, run `password.isBcryptedBounded(hash)` — if false, return `401`
    4. Both `401` cases return identical body: `{"message": "Invalid email or password"}`
    5. Create 30-day session, return `200 OK` with `AuthResponse`
  - `POST /logout`:
    1. Extract `Authorization: Bearer <token>` header → `401` if absent or malformed
    2. `userRepo.findSession(token)` → `401` if not found
    3. `userRepo.deleteSession(token)`, return `204 No Content`

## 8. Wire into ApiRoutes

- [ ] 8.1 In `backend/src/main/scala/com/helio/api/ApiRoutes.scala`, instantiate `AuthRoutes(userRepo)` and add `pathPrefix("auth") { auth.routes }` under the `/api` prefix
- [ ] 8.2 In `backend/src/main/scala/com/helio/app/Main.scala`, instantiate `UserRepository(db)` and pass it to `ApiRoutes`

## 9. Tests

- [ ] 9.1 Add to `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — register scenarios:
  - Successful registration returns `201` with token + user (no password_hash in body)
  - Duplicate email returns `409`
  - Invalid email returns `400`
  - Password too short returns `400`
- [ ] 9.2 Add login scenarios:
  - Successful login returns `200` with token + user
  - Wrong password returns `401` with generic message
  - Unknown email returns `401` with identical generic message
  - Missing fields returns `400`
- [ ] 9.3 Add logout scenarios:
  - Successful logout with valid token returns `204` and subsequent logout with same token returns `401`
  - No `Authorization` header returns `401`
  - Unrecognised token returns `401`
- [ ] 9.4 Update `TRUNCATE` statement in `beforeEach`/`afterEach` to include `user_sessions, users` (cascade order matters — sessions before users, or rely on CASCADE)

## 10. Verification

- [ ] 10.1 Run `sbt test` in `backend/` — all tests pass
- [ ] 10.2 Confirm no `password_hash` field appears in any API response (grep test assertions)
