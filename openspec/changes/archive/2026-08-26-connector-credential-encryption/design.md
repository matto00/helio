## Context

`SecretField`/`HasSecrets`/`SecretBackend`/`InlineSecretBackend`
(`backend/src/main/scala/com/helio/services/auth/SecretField.scala`, HEL-460) already declare the
seam: `SecretBackend.mask` is the only method today, used for display-time redaction. This ticket
adds the storage-time counterpart — a reversible, encrypted-at-rest representation — without
touching that interface's callers. `TokenHashing` (one-way SHA-256, used for session/MFA/PAT
tokens) is confirmed unusable here: an outbound connector call needs the recoverable plaintext, not
a hash. Today `data_sources.config` stores the raw token in plaintext JSON; `SecretRedaction` masks
it only on the read path.

## Goals / Non-Goals

**Goals:** envelope-encrypted, owner-scoped, RLS-protected credential storage; fail-closed on a
missing/misconfigured master key; a working local-dev/CI path with no production secret; documented
rotation story; a `MasterKeyProvider` seam shaped so a future Cloud-KMS implementation can be swapped in
without redesigning callers.

**Non-goals:** provisioning any GCP resource; building v1.9 connectors; a UI for credential
management (out of scope until HEL-821 and its siblings).

## Decision 1: Secret Manager pepper, not Cloud KMS (given, not re-opened)

The master key is a single symmetric key stored as a Secret Manager secret and injected into the
backend process exactly like `helio-anthropic-api-key` is today (`infra/deploy-backend.sh
--set-secrets`), read from the env var `CONNECTOR_MASTER_KEY`. Envelope encryption happens
in-application: each credential gets its own random 256-bit data key (AES-256-GCM), the data key is
itself wrapped (AES-256-GCM) under the master key, and both the wrapped data key and the ciphertext
are stored per-row. This adds zero new GCP services, zero new IAM surface, and zero new failure mode
in the outbound-request path — production already depends on Secret Manager working for the
Anthropic key.

Cloud KMS remains the more defensible long-term answer for compliance (HSM-backed, no key material
ever leaves KMS, native audit trail). The `MasterKeyProvider` seam below is deliberately
narrow — `wrap`/`unwrap` a data key, given a key id — so a `KmsMasterKeyProvider` can be substituted
later with **no** change to `EncryptedSecretBackend`, the repository, or any caller. **What a future
swap requires:** every existing row's wrapped data key was wrapped under the Secret-Manager pepper,
not KMS, so a KMS migration must re-wrap every existing data key (unwrap under the old pepper, wrap
under the new KMS key), then flip the active provider — this is exactly a rotation event, using the
same rotation mechanism as Decision 4, not a new one-off migration path.

## Decision 2: Storage shape — `connector_credentials` table, Flyway V92

Confirmed the live tree's Flyway high-water mark is `V91__audit_events.sql` (HEL-471); the ticket's
own "V59" figure is stale. Next free version is **V92**.

```sql
CREATE TABLE connector_credentials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,               -- caller-chosen label, not secret
  key_id         TEXT NOT NULL,                -- identifies which master key wrapped the data key (rotation)
  wrapped_data_key BYTEA NOT NULL,             -- data key, AES-256-GCM under the master key
  nonce_dek      BYTEA NOT NULL,               -- GCM nonce for the wrapped-data-key layer
  ciphertext     BYTEA NOT NULL,               -- credential value, AES-256-GCM under the data key
  nonce_value    BYTEA NOT NULL,               -- GCM nonce for the value layer
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_connector_credentials_user_id ON connector_credentials (user_id);

ALTER TABLE connector_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_credentials FORCE ROW LEVEL SECURITY;

CREATE POLICY connector_credentials_owner ON connector_credentials
  USING (user_id = current_setting('app.current_user_id')::uuid);
```

Follows the `V35`/`V42` owner-only pattern exactly (single `USING`, no `WITH CHECK`, so the same
predicate gates INSERT); reads/writes go through `DbContext.withUserContext` on the app pool, same
as `ApiTokenRepository`. `helio_privileged` grants are inherited from the V38 `ALTER DEFAULT
PRIVILEGES`, same as every table created since.

No columns hold plaintext or a value that, on its own, is sufficient to decrypt (the master key
never touches the database). `name` is a caller label (e.g. "Stripe API key"), not secret.

## Decision 3: Fail-closed on missing/misconfigured master key, and the `key_id` / provider shape

Every master key is identified by a `key_id: String` — a short, human-assigned label for *which*
value of `CONNECTOR_MASTER_KEY` (or `CONNECTOR_MASTER_KEY_PREVIOUS`, during a rotation window) is
currently active, e.g. `"env-2026-08"`. `key_id` is **not derived from the key material** (no
hash-of-the-key scheme) — it is an explicit, operator-assigned string set alongside the key value
(e.g. `CONNECTOR_MASTER_KEY_ID=env-2026-08`), so it is stable, greppable, and doesn't require
touching key bytes to know which key wrapped a given row.

**Round-2 skeptic fix:** raw key material never crosses the provider boundary — only Decision 1's
`wrap`/`unwrap` operations do. This is what actually makes the KMS swap (Decision 1) possible with
no change to `EncryptedSecretBackend`: a KMS-backed provider's `wrapDataKey`/`unwrapDataKey` call
out to KMS's own wrap/unwrap RPCs and the key itself never leaves KMS, exactly as a real KMS
integration requires.

```scala
final case class WrappedKey(keyId: String, ciphertext: Array[Byte], nonce: Array[Byte])

trait MasterKeyProvider {
  // Wraps a freshly-generated data key under the currently-active master key.
  // Left(MasterKeyError.NoKeyConfigured) when CONNECTOR_MASTER_KEY is absent/invalid.
  def wrapDataKey(dataKey: Array[Byte]): Either[MasterKeyError, WrappedKey]
  // Unwraps a data key previously wrapped under wrapped.keyId — resolves that id against
  // CONNECTOR_MASTER_KEY_ID first, then (rotation window only) CONNECTOR_MASTER_KEY_PREVIOUS_ID.
  // Left(MasterKeyError.UnknownKeyId) when wrapped.keyId names a key this provider cannot resolve.
  def unwrapDataKey(wrapped: WrappedKey): Either[MasterKeyError, Array[Byte]]
}
```

The env-backed implementation performs the wrap/unwrap itself (AES-256-GCM, keyed by the resolved
`CONNECTOR_MASTER_KEY` bytes) since a raw symmetric key is exactly what a Secret-Manager pepper is;
a future `KmsMasterKeyProvider` implements the same two methods by calling KMS's wrap/unwrap API
instead, with `MasterKey` bytes never touching application code in that implementation. Outside a
rotation window only one key is ever configured, so `unwrapDataKey` only ever succeeds for the
current `key_id` — this is what makes Decision 5's re-wrap job possible without a third storage
location for old keys.

`EncryptedSecretBackend.encrypt` requires `wrapDataKey` to succeed; if `MasterKeyProvider` is
unconfigured, `wrapDataKey` returns a `Left` and `encrypt` returns a `Left` too — there is no code
path from "no key" to "write ciphertext-that-is-actually-plaintext" or "write plaintext." The
repository layer treats that `Left` as a hard failure of the write (no row persisted at all, not a
partially-written row). This is enforced by construction, not by a runtime check someone could
accidentally bypass: `EncryptedSecretBackend`'s constructor takes a `MasterKeyProvider`, never a raw
key, and every encrypt call re-resolves it — a provider that fails today fails every write today,
including the very first one after a bad deploy. The most important test in this ticket (per the
ticket's own emphasis) asserts exactly this: unset `CONNECTOR_MASTER_KEY`, attempt a write, assert
it fails loudly and assert zero rows exist afterward.

Decrypting under the wrong/rotated key fails the same way: GCM authentication tag verification
fails inside `unwrapDataKey` (or `wrapped.keyId` isn't resolvable at all), `decrypt` returns a
`Left`, never a garbage/corrupted plaintext.

## Decision 3a: `EncryptedSecretBackend` does not extend `SecretBackend` (resolves skeptic CR4)

`SecretBackend` (`SecretField.scala`) has exactly one method, `mask(rawValue: String): String`, used
today only for display-time redaction (`SecretRedaction.redact`), and its contract is total and
infallible — it always returns a displayable string. Storage-time encryption is a different
operation with a different failure mode (it must be able to fail, per Decision 3), so
`EncryptedSecretBackend` is a **separate trait**, not a `SecretBackend` implementation:

```scala
trait EncryptedSecretBackend {
  def encrypt(plaintext: String): Either[MasterKeyError, EncryptedPayload]
  def decrypt(payload: EncryptedPayload): Either[MasterKeyError, String]
}
```

Nothing about this changes `SecretRedaction.redact`'s call sites or `SecretBackend`'s existing
contract — the "build on the seam, don't invent a parallel mechanism" requirement is satisfied by
implementing `EncryptedSecretBackend` in the same `com.helio.services.auth` package, next to
`SecretField.scala`, reusing its naming/placement convention, not by force-fitting it into
`SecretBackend`'s single infallible `mask` method. A `SecretRedaction.redact(config, backend)` call
site is never given an `EncryptedSecretBackend` — encryption and display-masking remain distinct
operations invoked from distinct call sites (masking on API read paths; encryption in the
credential-write repository path).

`SecretField.scala:19-22` and `:27-30`'s scaladoc currently state that HEL-536 "will add its own
`SecretBackend` implementation behind this interface" — under this decision that sentence becomes
inaccurate the moment this change lands, so task 3.5 updates both blocks to instead point at
`EncryptedSecretBackend` as a sibling, non-`SecretBackend` trait (one line: `mask` is total/
infallible; encryption must be able to fail).

## Decision 4: Local dev and CI without the production secret

Deliberate choice, and the single authoritative statement of it (proposal.md and spec.md both
defer to this section — resolves skeptic round-1 CR1): **no baked-in fallback key in code, and no
environment-conditional master-key logic at all.** `CONNECTOR_MASTER_KEY` is an ordinary required
env var, resolved identically in every environment — read the same way `RESEND_API_KEY`/
`HELIO_EMAIL_FROM` are read by `EmailConfig`. There is no "dev mode" branch in application code to
get wrong, because there is no branch. Concretely:

- **Local dev**: developers set `CONNECTOR_MASTER_KEY` to any local value in their own `.env`
  (gitignored, same as `DATABASE_URL`) — documented in `docs/cloud-dev-setup.md` and the CLAUDE.md
  env-var table alongside the other conditional vars.
- **CI**: the test suite sets `CONNECTOR_MASTER_KEY` to a fixed, clearly-named test-only value
  directly in the test harness/CI environment (not committed as a "default" anyone could
  accidentally deploy with) before running `sbt test`.
- **Production**: `infra/deploy-backend.sh` sources it from Secret Manager via `--set-secrets`,
  exactly like `helio-anthropic-api-key`, documented below.

A local/CI/production deployment differ only in *which value* they put in `CONNECTOR_MASTER_KEY`
and *how* that value gets there (a `.env` file vs. a CI env var vs. Secret Manager injection) — the
resolution code itself never asks "which environment am I in."

## Decision 5: Rotation procedure (executable — resolves skeptic CR2)

1. Generate a new master key value and a new `key_id` label (e.g. `env-2026-09`). Store the new
   value as a **new** Secret Manager secret version.
2. Set `CONNECTOR_MASTER_KEY_PREVIOUS`/`CONNECTOR_MASTER_KEY_PREVIOUS_ID` to the **old**
   key/id, and `CONNECTOR_MASTER_KEY`/`CONNECTOR_MASTER_KEY_ID` to the **new** key/id, then
   redeploy. `wrapDataKey` now wraps under the new key for all new writes; `unwrapDataKey` on a
   row still carrying the old `key_id` still resolves via the `_PREVIOUS` pair, so existing rows
   remain decryptable throughout the rotation window.
3. Run the re-wrap job (task 5.2): for every `connector_credentials` row where `key_id <> new_id`,
   call `provider.unwrapDataKey(WrappedKey(row.key_id, row.wrapped_data_key, row.nonce_dek))` to
   recover the raw data key, then `provider.wrapDataKey(dataKey)` to re-wrap it under the new
   current key, and update `wrapped_data_key`/`nonce_dek`/`key_id`/`updated_at` in place. The
   `ciphertext` itself (wrapped by the per-row data key, not the master key) is never re-encrypted —
   only the data-key wrapping layer changes, which is the entire point of envelope encryption.
4. Once every row's `key_id` equals the new id, unset `CONNECTOR_MASTER_KEY_PREVIOUS`/
   `CONNECTOR_MASTER_KEY_PREVIOUS_ID` and redeploy, then retire the old Secret Manager secret
   version.
5. A future Cloud-KMS swap (Decision 1) is the same procedure, generalized: the "previous" provider
   is the Secret-Manager-pepper `MasterKeyProvider`, the "current" provider is the KMS-backed one;
   steps 2–4 are unchanged because both providers implement the same `wrapDataKey`/`unwrapDataKey` shape.

## Gate-Chain Implications Checklist

This change does not touch `.husky/**` or any script a pre-commit hook invokes — no gate-chain
script is added or modified. N/A.
