## Why

Google sign-in is broken in production. The OAuth CSRF state lives in a JVM-wide `ConcurrentHashMap`
in `object AuthService`, but production runs up to two Cloud Run instances with scale-to-zero. When
the callback lands on a different process than the initiation — or the originating process is
reclaimed during the consent-screen wait — `validateCsrfState` finds nothing and the login fails with
`400 "Invalid or missing OAuth state parameter"`. This is a live incident; the owner is locked out of
their primary login method.

## What Changes

- Move the OAuth CSRF state store out of process memory into a short-lived Postgres table, so any
  instance can validate a state any other instance issued.
- Preserve the security semantics exactly: the same 5-minute TTL, the same single-use property (an
  atomic delete-and-return replaces `ConcurrentHashMap.remove`), and the same `400` rejection for a
  forged, unknown, expired, or already-consumed state.
- Add expiry-driven pruning so the table cannot grow without bound.
- No cookie is introduced, and no new secret is provisioned — deliberately, see `design.md`.
- **Not** a change to `min-instances`: that would mask the defect while the two-instance race survives.

## Capabilities

### New Capabilities

- `oauth-state-persistence`: durable, cross-instance storage of short-lived OAuth CSRF state values —
  issue, atomically consume once, expire after the TTL, and prune expired rows.

### Modified Capabilities

- `google-oauth-login`: the consent redirect and callback gain an explicit, currently-unspecified
  requirement that the CSRF state round trip succeeds across instances and that an invalid, expired,
  or replayed state is rejected with `400`.

## Non-goals

- `min-instances=0` and the associated cold-start latency — an aggravating factor, tracked separately.
- Any change to password login, PAT auth, MFA, or session-cookie handling.
- A general-purpose distributed cache or session store.
- HEL-530 keyed token hashing, which is adjacent but not required here.

## Impact

- `backend/src/main/scala/com/helio/services/auth/AuthService.scala` (the store and its two forwarders)
- `backend/src/main/scala/com/helio/api/routes/auth/OAuthRoutes.scala` (state validation call site)
- A new repository for the state table, wired through `ApiRoutes`
- One new Flyway migration — number derived from the tree at the moment it is written
- Backend tests, including the cross-process round-trip test that is this ticket's load-bearing evidence
