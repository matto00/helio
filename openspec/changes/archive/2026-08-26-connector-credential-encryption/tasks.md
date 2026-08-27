## 1. Migration

- [x] 1.1 `backend/src/main/resources/db/migration/V92__connector_credentials.sql` — table
      (including `key_id`), index, RLS (owner-only, `FORCE ROW LEVEL SECURITY`), per Decision 2.

## 2. Master key resolution

- [x] 2.1 `MasterKeyProvider` trait (`wrapDataKey(dataKey)`, `unwrapDataKey(wrapped: WrappedKey)`
      — raw key material never crosses this boundary, only wrap/unwrap results, per Decision 3) +
      env-backed implementation reading `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` (current)
      and `CONNECTOR_MASTER_KEY_PREVIOUS`/`CONNECTOR_MASTER_KEY_PREVIOUS_ID` (rotation window
      only), returning `Either[MasterKeyError, _]`. No fallback value baked into code; no
      environment-conditional logic (Decision 3, Decision 4).
- [x] 2.2 Document `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` (and the two `_PREVIOUS`
      variants, rotation-only) in CLAUDE.md's production-env-vars table, matching the style of
      `RESEND_API_KEY`/`ANTHROPIC_API_KEY` rows (Conditional, what it's required for, how it's
      sourced in prod).
- [x] 2.3 `docs/cloud-dev-setup.md` (or `.env.example`) note: local dev must set
      `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` to any local value — same var, same
      resolution code as production (Decision 4).

## 3. Envelope encryption helper

- [x] 3.1 `EncryptedSecretBackend` — a standalone trait (does **not** extend `SecretBackend`; see
      design.md Decision 3a), living in `com.helio.services.auth` alongside `SecretField.scala`:
      `encrypt(plaintext): Either[MasterKeyError, EncryptedPayload]`,
      `decrypt(payload): Either[MasterKeyError, String]`. AES-256-GCM data-key generation;
      `wrapDataKey`/`unwrapDataKey` calls out to the injected `MasterKeyProvider` (Decision 3) —
      `EncryptedSecretBackend` never sees raw master-key bytes, only `WrappedKey` results — then
      encrypt/decrypt the value under the (unwrapped) data key locally. Constructor takes a
      `MasterKeyProvider`, never a raw key.
- [x] 3.2 Fail-closed unit test: `wrapDataKey` returns `Left(MasterKeyError.NoKeyConfigured)` when
      `CONNECTOR_MASTER_KEY` is unset → `encrypt` returns `Left`, never a plaintext-shaped success,
      and no row is persisted. This is the most important negative test in the ticket.
- [x] 3.3 Wrong/rotated-key unit test: encrypt under key A, attempt decrypt with only key B
      configured (A not resolvable via `unwrapDataKey`) → `Left`, not corrupted plaintext. Also
      assert `unwrapDataKey` on a `key_id` that matches neither the current nor `_PREVIOUS` id
      returns `Left(UnknownKeyId)` rather than falling through to the current key.
- [x] 3.4 Round-trip unit test: encrypt then decrypt under the same key → original plaintext.
- [x] 3.5 Update `SecretField.scala:19-22` and `:27-30`'s scaladoc: replace the "HEL-536 ... will
      add its own `SecretBackend` implementation behind this interface" claim with a pointer to
      `EncryptedSecretBackend` as a sibling, non-`SecretBackend` trait (one line on why: `mask` is
      total/infallible, encryption must be able to fail). Resolves skeptic round-2 CR4.

## 4. Repository

- [x] 4.1 `ConnectorCredentialRepository` (Slick, mirrors `ApiTokenRepository`'s shape): `create`,
      `get` (returns metadata only — id/name/key_id/timestamps, never plaintext or ciphertext),
      `decryptForUse(id)` (a distinctly-named method — the only path that returns plaintext,
      intended to be called solely from the server-side connector-call code path, never from a
      route handler that serializes its result to JSON), `delete`. All scoped through
      `DbContext.withUserContext`. `create` calls `EncryptedSecretBackend.encrypt`; on `Left`, no
      row is persisted and the failure propagates.
- [x] 4.2 DB-level integration test: write a credential, then query `connector_credentials` directly
      (bypassing the repository) and assert the raw `ciphertext` column does not equal, and does not
      contain as a substring, the plaintext value that was written. This is the ticket's acceptance
      criterion — code-level assertions alone do not satisfy it.
- [x] 4.3 RLS integration test, run under a **non-bypassing** app-role DB session — reuse the
      `helio_app_test` role/harness already built for this in
      `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala:20-60`
      (see also `openspec/changes/archive/2026-08-26-audit-query-api-ui/` for why a non-bypassing
      role is required — HEL-488's evaluator caught a test that couldn't structurally distinguish
      RLS-enforced from RLS-bypassed reads): user A writes a credential; querying as user B's
      session context returns zero rows.
- [x] 4.4 Test/assert that `get`'s (and any JSON formatter's) result type has no field capable of
      carrying the decrypted plaintext — e.g. by giving the metadata-only return type no
      `plaintext`/`value` field at all, so there is nothing for a `JsonProtocols` formatter to
      accidentally serialize. Covers the "decrypted values never returned to API clients"
      requirement structurally, not just by omission from routes (resolves skeptic CR5 — this
      ticket adds no routes itself, but the repository shape must not make that easy to get wrong
      later in HEL-821).

## 5. Rotation runbook

- [x] 5.1 Document the rotation procedure (Decision 5) — the `CONNECTOR_MASTER_KEY_PREVIOUS`/
      `_PREVIOUS_ID` mechanism and the re-wrap job below — at `docs/secrets-inventory.md` (new file;
      no such runbook exists yet in this repo). Also add `helio-anthropic-api-key` and
      `CONNECTOR_MASTER_KEY` as its first two entries, so future secrets (e.g. `RESEND_API_KEY`)
      have a clear place to be added.
- [x] 5.2 Implement the re-wrap job used by rotation step 3: for every `connector_credentials` row
      whose `key_id` is not the currently-configured `CONNECTOR_MASTER_KEY_ID`, call
      `provider.unwrapDataKey(WrappedKey(row.key_id, row.wrapped_data_key, row.nonce_dek))`, then
      `provider.wrapDataKey(dataKey)` to re-wrap under the new current key, and update
      `wrapped_data_key`/`nonce_dek`/`key_id`/`updated_at`. A one-shot maintenance script/task, not
      an HTTP route (no client-facing surface for this ticket). Test it against a row seeded under
      a fake "old" key_id/key pair.

## 6. Verification

- [x] 6.1 `sbt compile test` green.
- [x] 6.2 Confirm no plaintext credential value crosses a log statement or `toString` anywhere in
      this new code: give `EncryptedPayload`/any type that transiently holds the plaintext a
      redacted `toString` (the `EmailConfig` precedent design.md cites), and grep the new files for
      `println`/`log.info`/`log.debug` calls that reference the plaintext variable. No such
      mechanical guard exists in this repo yet for connector secrets (HEL-616 is filed, not built) —
      do this as an explicit review step here, not by relying on a guard that doesn't exist.
