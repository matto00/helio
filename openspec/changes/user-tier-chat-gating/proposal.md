# Proposal: user-tier-chat-gating

## Why

Assistant/chat access currently has no notion of account standing: any authenticated user gets unlimited
Claude-backed chat, which is untenable for a multi-tenant SaaS rollout (cost exposure, no rollout control).
HEL-701 introduces account tiers; this first child ticket adds the tier model and uses it to gate the most
expensive surface — the assistant — ahead of MFA (HEL-702) and invite codes (HEL-704).

## What Changes

- Add a `tier` column to the user record: `free` | `beta` | `owner`. Default `free` for all new signups
  (Flyway migration **V88** — V87 is taken by in-flight HEL-698).
- Config-driven owner-email allowlist (env-var-backed, e.g. `HELIO_OWNER_EMAILS`): a matching email is
  assigned `owner` at signup and promoted to `owner` at login, on **both** auth paths (password + Google
  OAuth) — no one-off DB edits; survives a fresh environment.
- Gate every `AssistantConversationRoutes` endpoint (list/create/messages/converse and siblings):
  `free` → 403 with a machine-readable error code the frontend renders as a "request access" prompt.
- `beta` → chat allowed but message sends are capped per day by a config-backed limit; exceeding it
  returns a clear, machine-readable limit-reached error.
- `owner` → unlimited.
- The authenticated-user payload (`GET /api/auth/me`) includes `tier` so the frontend can render locked
  states proactively as well as reactively.
- Frontend assistant feature renders two new states: request-access (free) and daily-limit-reached (beta).

## Capabilities

### New Capabilities

- `user-tier-model`: the tier enum on the user record, default-free assignment, and the config-driven
  owner-email allowlist semantics at signup/login across both auth providers.
- `tier-gated-assistant-access`: tier enforcement on all assistant conversation endpoints (free denial,
  beta daily cap, owner unlimited), the machine-readable error contract, and the frontend request-access /
  limit-reached surfacing. (Gating requirements live here rather than as deltas to each assistant spec.)

### Modified Capabilities

- `user-persistence`: users table schema gains a constrained `tier` column with default `free`.
- `email-password-auth`: registration assigns tier (allowlist-aware); login promotes an allowlisted email.
- `google-oauth-login`: first-time OAuth user creation assigns tier; returning OAuth login promotes an
  allowlisted email.
- `request-authentication`: `GET /api/auth/me` response includes the user's tier.

## Impact

- Backend: `UserRepository` (+ user model), `AuthService`, `AuthRoutes`, `OAuthRoutes`,
  `AssistantConversationRoutes`, config (`application.conf` + env), Flyway V88, `JsonProtocols`.
- Frontend: assistant feature slice/components (error-code handling, locked/limit states), auth state (tier).
- No changes to other API surfaces; no data backfill beyond the column default.

## Non-goals

- No admin UI/endpoint for assigning `beta` (manual DB update for now; invite-code flow is HEL-704).
- No automatic demotion when an email leaves the allowlist (allowlist only promotes).
- No billing/upgrade flow — the "request access" prompt is informational only this pass.
- No gating of non-assistant surfaces (dashboards, pipelines, MCP/PAT paths) in this ticket.
