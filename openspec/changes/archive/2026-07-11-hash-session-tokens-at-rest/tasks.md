# Tasks — hash-session-tokens-at-rest

### Backend

- [x] 1.1 Add `com.helio.infrastructure.TokenHashing` with `sha256Hex(raw: String): String` (extract from `ApiTokenService.sha256Hex`)
- [x] 1.2 Update `ApiTokenService.sha256Hex` to delegate to `TokenHashing.sha256Hex` (no behavior change; `AuthDirectives` call site untouched)
- [x] 1.3 Add `backend/src/main/resources/db/migration/V45__hash_session_tokens.sql`: `DELETE FROM user_sessions;` then rename `token` → `token_hash` and rename `user_sessions_token_unique` → `user_sessions_token_hash_unique`
- [x] 1.4 `UserRepository.SessionRow`: rename field `token` → `tokenHash`; `SessionTable`: map `tokenHash` to column `token_hash`
- [x] 1.5 `UserRepository.createSession`: hash `session.token` via `TokenHashing.sha256Hex` before building the row; return the original (raw-token) `session` unchanged
- [x] 1.6 `UserRepository.findSession`: hash the incoming raw `token` param before filtering on `tokenHash`; construct the returned `UserSession` with the raw `token` param (not the row's hash)
- [x] 1.7 `UserRepository.deleteSession`: hash the incoming raw `token` param before filtering on `tokenHash`
- [x] 1.8 `SlickUserSessionRepository.findValidSession`: hash the incoming `token` before filtering on `tokenHash`

### Tests

- [x] 2.1 Add/extend a `UserRepository`- or `AuthService`-level test asserting the persisted `user_sessions.token_hash` value is the SHA-256 hex digest of the raw token, not the raw token itself
- [x] 2.2 Add a repository-level test for `findSession`/`deleteSession`/`findValidSession` confirming a raw token presented at lookup time correctly matches its hashed row
- [x] 2.3 Verify existing register/login/logout/`GET /api/auth/me` tests in `ApiRoutesSpec` (real-session-repo path) and `GoogleOAuthRoutesSpec` still pass unchanged (round-trip through `AuthService`, no fixture inserts a raw token directly)
- [x] 2.4 Gates: `sbt test` green; confirm no other suite references `user_sessions.token` post-rename
