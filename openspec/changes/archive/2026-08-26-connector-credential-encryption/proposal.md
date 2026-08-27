## Why

v1.9 connectors (HEL-429/HEL-820/HEL-821) need to store per-user third-party credentials, and
today's `data_sources.config` stores raw bearer tokens/API keys in plaintext — `SecretRedaction`
(HEL-460) only masks values on read. Landing an encryption-at-rest standard now, standalone, gives
it its own adversarial review before HEL-821 becomes its first real consumer.

## What Changes

- Add an application-layer envelope-encryption helper (`EncryptedSecretBackend`) — a standalone
  trait living alongside the existing `SecretField`/`HasSecrets`/`SecretBackend` seam
  (`SecretField.scala`, HEL-460), not an implementation of `SecretBackend` (its `mask` contract is
  total/infallible; encryption must be able to fail — see design.md Decision 3a): per-credential
  data key, wrapped by a master key sourced from a Secret Manager pepper (env var), AES-GCM for
  both layers.
- Add a reusable owner-scoped encrypted-credential storage table (Flyway `V92`), RLS-protected
  following the `V35`/`V42` owner-only conventions and `DbContext.withUserContext`.
- Master key absent/misconfigured **must** fail hard on write — never silently store plaintext.
- Local dev/CI supply a non-production key **value** through the same single `CONNECTOR_MASTER_KEY`
  env var operators use in production — no development-only key exists in application code, so there
  is no dev/prod branch that could leak (see design.md Decision 4).
- Document master-key rotation (re-wrap data keys) and what a future Cloud-KMS-backed
  `MasterKeyProvider` would require, without reshaping callers.
- Document the required Secret Manager secret and `infra/deploy-backend.sh` wiring for the user to
  provision manually — this change provisions no GCP resources itself.

## Capabilities

### New Capabilities
- `connector-credential-encryption`: envelope-encrypted, owner-scoped credential storage substrate
  (encrypt/decrypt helper, RLS-protected table, fail-closed master-key handling, rotation story).

### Modified Capabilities
(none — `SecretField`/`SecretBackend`/`SecretRedaction` are unchanged; `EncryptedSecretBackend` is a
new, separate trait alongside them, not a new `SecretBackend` implementation)

## Impact

- New: `backend/.../services/auth/EncryptedSecretBackend.scala` (or similarly named), a
  `MasterKeyProvider`, a `connector_credentials` repository, Flyway `V92__connector_credentials.sql`.
- Config: new `CONNECTOR_MASTER_KEY` env var (documented in CLAUDE.md's prod-env-vars table).
- No route changes — this is a storage substrate consumed later by HEL-821; no client-visible API.
- No GCP resources provisioned by this change.

## Non-goals

- Building actual v1.9 connectors (HEL-429/HEL-821).
- Rotating the Anthropic/DB/OAuth secrets (sibling tickets).
- Provisioning the Secret Manager secret or editing `infra/deploy-backend.sh` (documented, not done).
