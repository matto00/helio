## Why

Anyone can claim the Owner tier in prod: the owner allowlist matches case-insensitively, but email uniqueness is case-sensitive and password signup verifies nothing, so registering an upper-cased variant of the (publicly committed) owner address creates a second account that is assigned Owner at insert. Owner unlocks `/api/admin/usage` and unlimited assistant and AI-pipeline quota billed to the owner. See ticket.md.

## What Changes

- One shared email normaliser (trim + lowercase) applied on register, login and Google sign-in, before lookup, insert and the allowlist check.
- Flyway migration V148: lowercase (and trim) stored `users.email`, drop the case-sensitive `UNIQUE` constraint, add a unique index on `lower(email)`. Aborts with a clear error naming the duplicate count when case/whitespace duplicates exist; never merges or drops rows.
- **BREAKING (security):** the owner allowlist no longer grants or promotes Owner on a password signup or password login. Owner is granted or promoted only on Google sign-in whose userinfo response has `email_verified == true`. Existing Owner rows are never demoted.
- `GoogleProfile` gains `emailVerified` parsed from Google userinfo's `email_verified` (missing or non-true means unverified; never a crash).
- A register that races past the existence check and hits the new unique index returns 409, not 500.
- `HELIO_OWNER_EMAILS` moves from a literal in `.github/workflows/cd-backend.yml` and `infra/deploy-backend.sh` env vars to Secret Manager secret `helio-owner-emails`; a CI-checked guard fails if an `@`-address reappears in the deploy env-var flags.
- Docs: CLAUDE.md env-var row, docs/secrets-inventory.md. The canonical `user-tier-model` spec and `GoogleOAuthRoutesSpec` stop carrying the real owner address (fake `owner@example.test`).

## Capabilities

### New Capabilities
- `email-normalization`: emails are trimmed and lowercased at every auth entry point, and the database enforces case-insensitive uniqueness.

### Modified Capabilities
- `user-tier-model`: the allowlist applies only to verified Google sign-in; password paths never grant or promote Owner.
- `email-password-auth`: registration/login normalise email; registration never assigns Owner; login never promotes; case-variant duplicate is 409.
- `google-oauth-login`: profile carries `email_verified`; Owner assigned/promoted only when verified; email normalised.
- `production-deployment-docs`: the owner allowlist is a Secret Manager secret, never a literal deploy flag.

## Impact

- Backend: `RequestValidation`/a new normaliser, `AuthService`, `UserRepository`, `AuthProtocol` (`GoogleProfile`), new `V148__users_email_lower_unique.sql`, specs under `backend/src/test`.
- CI/infra: `.github/workflows/cd-backend.yml`, `infra/deploy-backend.sh`, a new guard script + its CI wiring.
- Docs: CLAUDE.md (env-var table row only), docs/secrets-inventory.md.
- Release: gated on the owner creating `helio-owner-emails`, granting secretAccessor, and checking prod for case-duplicates and unexpected Owner rows.
- No frontend change (the server is the authority).
