# HEL-703: Add user tier model + gate chat/assistant access by tier

## Description

### Scope

* Add a `tier` column to the user record: `free` | `beta` | `owner`. Default `free` for all new signups.
* Seed/assign the product owner's existing account to `owner` (config-driven — e.g. an owner-email allowlist checked at signup/login — rather than a one-off manual DB edit, so it survives a fresh environment).
* Gate `AssistantConversationRoutes` (list/create/messages/converse — all chat surfaces) to 403 for `free`-tier users, with a clear client-facing error the frontend can render as an upgrade/request-access prompt rather than a generic failure.
* `beta`-tier gets chat access capped at a tunable limit (start with a simple conservative constant — e.g. messages/day — configurable without a redeploy if easy, otherwise a plain config value is fine for this pass).
* `owner`-tier is unlimited.

## Acceptance Criteria

- [ ] A `free`-tier user gets a clear, non-generic error when attempting to use any chat endpoint; the frontend surfaces it as "request access" rather than a raw failure.
- [ ] A `beta`-tier user can use chat up to the configured cap, then gets a clear limit-reached message.
- [ ] The owner's account has unlimited access, verified end-to-end against the real deployed config (not just a unit test default).

## Delivery context (dispatcher notes)

- Part of epic HEL-701 (Account security + user tiers). Siblings HEL-702 (MFA) and HEL-704 (invite codes) are NOT in flight — no coordination needed.
- Owner account to allowlist as `owner` tier: `mattheworr018@gmail.com`, via a config-driven env-var-backed owner-email allowlist checked at signup/login (never a one-off DB edit).
- Both auth paths — password (`AuthService`/`AuthRoutes`) and Google OAuth (`OAuthRoutes`) — must assign tier consistently.
- New Flyway migration MUST be **V88** (V87 is taken by in-flight HEL-698; main's highest is V86 — confirmed live at setup time).
- This worktree runs against an ISOLATED dev database `helio_hel703` (see workflow-state.md) to avoid a shared-DB Flyway race with HEL-698.
- Priority: High. Team: Helio Platform. Ticket URL: https://linear.app/helioapp/issue/HEL-703/add-user-tier-model-gate-chatassistant-access-by-tier
