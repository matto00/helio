# HEL-288: Hash session tokens at rest (parity with API tokens)

## Problem

`user_sessions.token` is stored **raw** (V7 / V11). Anyone with DB read access (a leaked backup, a compromised replica, a misconfigured RLS bypass) can read active session tokens and impersonate any logged-in user by replaying them in the `Authorization` header.

This was surfaced while delivering HEL-148 Phase 1 (Personal Access Token auth), which introduced the project's **first hashed credential**: `api_tokens` stores only a SHA-256 hash, with the raw token shown once at creation. Sessions should reach parity.

## Scope

- Store only a hash (SHA-256, matching the `api_tokens` approach) of the session token in `user_sessions`.
- Hash the incoming token on lookup in `UserSessionRepository.findValidSession` (and anywhere else sessions are validated).
- Client-facing behavior is unchanged: the raw token is still what the client holds and sends in the `Authorization` header — only the at-rest representation changes.
- Migration: existing raw sessions cannot be re-derived into hashes, so expire/invalidate them on rollout (users re-login). Acceptable for a session store.

## Notes

- Behavior-preserving w.r.t. the auth contract; this is a security-hardening change, deliberately kept out of the HEL-148 scope (behavior-preserving rule).
- Reference implementation to mirror: `ApiTokenRepository` / `ApiTokenService` on branch `feature/agent-pat-auth/HEL-148`.

## Source

https://linear.app/helioapp/issue/HEL-288/hash-session-tokens-at-rest-parity-with-api-tokens
