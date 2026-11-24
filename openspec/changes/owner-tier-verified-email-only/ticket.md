# HEL-1852: Owner tier can be claimed by registering a case-variant of an owner email

## Description

Live in prod today, not only a pre-release gap. Found in the Nov 24 pre-release security review.

- `UserTierConfig.isOwnerEmail` compares case-insensitively (`services/auth/UserTierConfig.scala:16-19`).
- Email uniqueness is case-sensitive: `TEXT UNIQUE` in `db/migration/V6__users.sql:3`, exact-match `findByEmail` in `UserRepository.scala:48-49`, and `RequestValidation.validateRegisterRequest` doesn't normalize.
- Registration is open and assigns Owner at insert (`services/auth/AuthService.scala:112-120`). Google sign-in does the same (`UserRepository.scala:86,96`).
- `HELIO_OWNER_EMAILS` is committed in plain text in the public repo (`.github/workflows/cd-backend.yml` deploy flags and `infra/.env.deploy.example`).
- So anyone can read the owner address, register an upper-cased variant with a password, and get Owner tier: `/api/admin/usage`, plus unlimited assistant and AI-pipeline quota billed to the owner.

## Acceptance criteria (ticket)

- [ ] Emails are trimmed and lowercased on register, login and Google sign-in.
- [ ] A migration adds a unique index on `lower(email)` after checking prod for existing case-duplicates.
- [ ] Owner tier is granted only to a verified email (Google with `email_verified=true`, or after HEL-1715 verification) or by manual DB grant, never on a password sign-up alone.
- [ ] `HELIO_OWNER_EMAILS` moves to Secret Manager or a GitHub Actions variable and is removed from the workflow file and the example env.
- [ ] A one-time check lists prod users with Owner tier and confirms each is expected.
- [ ] Tests cover the case-variant register and the Google paths.

## Owner rulings (binding; relayed by the driver, recorded as decisions)

1. Scope:
   a. Trim + lowercase emails on register, login and Google sign-in through ONE shared normaliser.
   b. A Flyway migration (V148, next free) lowercases stored emails and replaces case-sensitive uniqueness with a unique index on `lower(email)`. It FAILS LOUDLY with a clear message if case-duplicates exist; it never merges or drops rows. Prod has not been checked for duplicates yet; the PR states the migration's release is gated on that check.
   c. Owner is granted or promoted ONLY through Google sign-in with `email_verified == true` (new field on `GoogleProfile`, parsed from Google's userinfo response). A password signup or password login NEVER grants or promotes Owner, even for an allowlisted email. An existing Owner keeps Owner (no demotion). Unverified Google sign-in for NON-owner accounts and account linking stay out of scope (HEL-1856); the PR says which part of HEL-1856 this covers (only the owner grant) and which it leaves.
2. Secret: move `HELIO_OWNER_EMAILS` out of `.github/workflows/cd-backend.yml` `--update-env-vars` into GCP Secret Manager as `helio-owner-emails`, wired via `--update-secrets` (`HELIO_OWNER_EMAILS=helio-owner-emails:latest`). Switch `infra/deploy-backend.sh` from `--set-env-vars ...HELIO_OWNER_EMAILS=...` to `--set-secrets`. Update CLAUDE.md's `HELIO_OWNER_EMAILS` row and docs/secrets-inventory.md. Do NOT create the secret or call gcloud; the PR body has a "Before release" section in this order: create the secret, grant the Cloud Run service account secretAccessor, run the prod duplicate check (and the owner-tier listing), then tag. `BetaAccessService`'s use of `ownerEmails` as notification recipients keeps working.

## Out of scope (driver/owner)

- `infra/.env.deploy.example` and every other `.env*` file: never read, grep or edit (driver handles the example with the owner).
- Rewriting git history (the address stays in history).
- Running anything against prod (the duplicate check and the Owner-tier listing are owner steps in "Before release").
