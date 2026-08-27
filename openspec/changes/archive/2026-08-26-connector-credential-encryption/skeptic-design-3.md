## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- Read all five artifacts in full: `proposal.md`, `design.md`, `tasks.md`,
  `specs/connector-credential-encryption/spec.md`, `ticket.md`.
- **Round-2 CR2 (Scala version) — RESOLVED.** `backend/build.sbt:1` is
  `ThisBuild / scalaVersion := "2.13.15"`. The named-tuple signature is gone;
  `design.md:94` now declares `final case class WrappedKey(keyId: String, ciphertext:
  Array[Byte], nonce: Array[Byte])` and `design.md:96-104` a two-method trait. Both are
  valid Scala 2.13.
- **Round-2 CR1 (provider shape / KMS-swap claim) — RESOLVED in design.md.** No raw key
  material crosses `MasterKeyProvider`; only `wrapDataKey(dataKey)` /
  `unwrapDataKey(wrapped)` do. Decision 1's swap claim now genuinely holds: a KMS provider
  implements exactly these two methods against KMS wrap/unwrap RPCs, with no change to
  `EncryptedSecretBackend`. Decision 5 step 3 and `tasks.md` 5.2 both use the new names
  consistently. **But see CR1 below — `tasks.md` 3.2 was missed.**
- **Round-2 CR3 (proposal/Decision 3a alignment) — PARTIALLY resolved.** `proposal.md`'s
  "What Changes" bullet 1 and the "Modified Capabilities" note now correctly describe
  `EncryptedSecretBackend` as a standalone trait. Three other places still call the
  KMS-swap seam a `SecretBackend` seam — see CR2.
- **Round-2 CR4 (SecretField.scala scaladoc) — RESOLVED and line numbers verified against
  ground truth.** `cat -n` confirms lines 19-22 are the `SecretBackend` scaladoc containing
  "HEL-536 ... will add its own `SecretBackend` implementation behind this interface", and
  lines 27-30 are the `InlineSecretBackend` scaladoc containing "HEL-536 owns future
  non-inline backends". `tasks.md` 3.5 cites both ranges accurately.
- **Flyway high-water mark verified.** `ls backend/src/main/resources/db/migration/` ends at
  `V91__audit_events.sql`; `V92` in Decision 2 / task 1.1 is correct, and the ticket's "V59"
  is correctly flagged stale.
- **RLS test-harness citation verified.** `backend/src/test/scala/com/helio/infrastructure/
  persistence/RlsOwnerTablesSpec.scala:20-60` is exactly the scaladoc describing the
  non-superuser `helio_app_test` role and second JDBC pool that task 4.3 wants reused. The
  citation is real, not invented.
- Cross-checked every AC in `ticket.md` against tasks: ciphertext-at-rest → 4.2; round-trip
  → 3.4; wrong/rotated key → 3.3; RLS non-bypassing → 4.3; rotation documented → 5.1/5.2;
  `sbt compile test` → 6.1; fail-closed-no-key → 3.2; local dev/CI no prod secret → 2.3 +
  Decision 4. No AC is uncovered; no task exceeds ticket scope.

### Verdict: REFUTE

Both items are residual stale references from the round-2 rename — cheap, mechanical, but
they leave the artifacts self-contradicting on the exact API this gate just re-shaped.

### Change Requests

1. **`tasks.md:32` (task 3.2) still calls a method that no longer exists.** It reads
   "Fail-closed unit test: `MasterKeyProvider.current()` returns `Left` → `encrypt` returns
   `Left`". `current()` was removed in the round-2 revision; the trait (`design.md:96-104`)
   now has only `wrapDataKey`/`unwrapDataKey`. This is the *single most important test in
   the ticket* per the ticket's own emphasis, and it is specified against a nonexistent API —
   an implementer either resurrects `current()` (undoing CR1) or guesses. Rewrite as:
   `wrapDataKey` returns `Left(MasterKeyError.NoKeyConfigured)` when `CONNECTOR_MASTER_KEY`
   is unset → `encrypt` returns `Left`, never a plaintext-shaped success, and no row is
   persisted.

2. **Three surviving "`SecretBackend` seam" references contradict Decision 3a.** Decision 3a
   establishes that the KMS-swappable seam is `MasterKeyProvider` and that
   `EncryptedSecretBackend` is *not* a `SecretBackend`. Still inconsistent:
   - `design.md:16-17` (Goals): "a `SecretBackend` seam shaped so a future Cloud-KMS
     implementation can be swapped in" → should be `MasterKeyProvider`.
   - `design.md:34`: "The `SecretBackend`/`MasterKeyProvider` seam below" → the seam below is
     `MasterKeyProvider` only; drop `SecretBackend`.
   - `proposal.md:22`: "what a future Cloud-KMS-backed `SecretBackend` would require" →
     should be a Cloud-KMS-backed `MasterKeyProvider`.

### Non-blocking notes

- `EncryptedPayload` is referenced in `design.md:140-141` and `tasks.md` 3.1/6.2 but its
  fields are never specified. Decision 2's columns (`key_id`, `wrapped_data_key`,
  `nonce_dek`, `ciphertext`, `nonce_value`) make the intent obvious, so this is not blocking,
  but naming the case class alongside `WrappedKey` in Decision 3a would remove the last
  unspecified type.
- `spec.md`'s "No environment-conditional key logic exists" scenario says
  "`CONNECTOR_MASTER_KEY` (and ... `CONNECTOR_MASTER_KEY_PREVIOUS`) are the only inputs",
  which predates Decision 3's `CONNECTOR_MASTER_KEY_ID` / `CONNECTOR_MASTER_KEY_PREVIOUS_ID`.
  The requirement's substance (no dev/prod branch) is unaffected, but a literal reader of the
  scenario would flag the two `_ID` vars. Worth adding them to the list when CR1/CR2 are
  applied.
- `tasks.md` 5.1 hedges on the runbook location ("or create one alongside it if none exists
  yet"). Acceptable, but the executor should resolve it to a concrete path rather than
  leaving the choice to a later reader.
