## Why

`user_sessions.token` is stored **raw** (V7/V11). DB read access (leaked backup,
compromised replica, misconfigured RLS bypass) lets an attacker replay the value
as a Bearer token and impersonate any logged-in user. HEL-148 Phase 1 introduced
the project's first hashed credential (`api_tokens.token_hash`, SHA-256);
sessions should reach parity.

## What Changes

- `user_sessions.token` renamed to `token_hash`; the app stores
  `SHA-256(raw token)`, never the raw value, mirroring `api_tokens`.
- New shared `TokenHashing.sha256Hex` helper, used by both `ApiTokenService`
  and the session code (dedupes the previously session-only hash logic).
- `UserRepository.createSession` hashes before insert; `findSession` /
  `deleteSession` (used by logout) and `SlickUserSessionRepository
  .findValidSession` hash the incoming raw token before querying.
- Client-facing contract unchanged: the client still holds/sends the raw
  token in `Authorization: Bearer <token>`; only at-rest storage changes.
- **Migration invalidates, does not rehash, existing sessions:** a raw value
  in the column can't be trusted as "the hash the app would have produced," so
  the migration deletes all existing `user_sessions` rows. Every logged-in
  user is signed out once on rollout and must log in again — the approach the
  ticket scopes in, acceptable for a session store. `api_tokens` unaffected.

## Non-goals

- Changing the session TTL, token generation, or the `Authorization` header
  contract.
- Migrating/rehashing existing raw values in place (rejected — see above).
- Any change to `api_tokens` (already hashed; used only as the reference
  implementation).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `session-persistence`: tighten "Token stored as secure hash" to specify the
  algorithm (SHA-256, matching `api_tokens`) and add the rollout-invalidation
  scenario (pre-existing raw sessions are deleted, not rehashed).

## Impact

- `UserRepository.scala` (`SessionRow`, `SessionTable`, `createSession`,
  `findSession`, `deleteSession`), `UserSessionRepository.scala`
  (`findValidSession`), `ApiTokenService.scala` (`sha256Hex` delegates)
- New: `infrastructure/TokenHashing.scala`;
  migration `V45__hash_session_tokens.sql`
- `openspec/specs/session-persistence/spec.md` (delta)
- `ApiRoutesSpec`/`GoogleOAuthRoutesSpec` round-trip through `AuthService`
  already — unaffected, no fixture inserts raw tokens directly.
