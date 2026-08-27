## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- Re-read in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/connector-credential-encryption/spec.md`, plus round 1's `skeptic-design-1.md`.
- **Round-1 CR1 (dev/CI key contradiction) — RESOLVED.** `design.md` Decision 4 is now the single
  authoritative statement ("no baked-in fallback key in code, and no environment-conditional
  master-key logic at all"). `proposal.md`'s bullet ("through the same single `CONNECTOR_MASTER_KEY`
  env var … no development-only key exists in application code") matches. `spec.md`'s final
  requirement and both its scenarios were rewritten to the same story — the old "development-only
  key path" / "dev key cannot activate in production" scenarios are gone. No `HELIO_ENV` gate
  survives anywhere (`grep -n HELIO_ENV` over the change dir: no hits).
- **Round-1 CR2 (rotation executable) — RESOLVED in substance.** `key_id` is now an
  operator-assigned label (`CONNECTOR_MASTER_KEY_ID`), explicitly not derived from key material;
  `forKeyId` exists; `_PREVIOUS`/`_PREVIOUS_ID` supply the old key during the window; Decision 5 is
  a concrete 4-step procedure; `tasks.md` 5.2 makes the re-wrap job a real build task with a test.
  This also retires round 1's non-blocking `updated_at`-is-never-written note (5.2 writes it).
- **Round-1 CR3 (HEL-616 guard) — RESOLVED.** `tasks.md` 6.2 no longer claims a guard exists; it
  now prescribes a redacted `toString` plus an explicit grep/review, and states outright that
  HEL-616 is filed-not-built.
- **Round-1 CR5 (plaintext never returned to clients) — RESOLVED.** `tasks.md` 4.1 splits
  metadata-only `get` from `decryptForUse(id)`, and 4.4 adds the structural test that the metadata
  type carries no plaintext-capable field. The spec requirement is now traceable to tasks.
- **Round-1 CR4 (`EncryptedSecretBackend` vs `SecretBackend`) — only PARTLY resolved.** `design.md`
  Decision 3a and `tasks.md` 3.1 are now unambiguous (standalone trait, does not extend
  `SecretBackend`), but `proposal.md` and an existing in-repo scaladoc still say the opposite — see
  CR 3 and CR 4 below.
- **New contradiction found in the round-2 edits** — Decision 1's provider surface vs. Decision 3's
  actual `MasterKeyProvider` signature; see CR 1.
- **Scala version checked against ground truth**: `backend/build.sbt:1` →
  `ThisBuild / scalaVersion := "2.13.15"`. Re-read to confirm. Relevant to CR 2.
- **`SecretField.scala` scaladoc read at ground truth**:
  `backend/src/main/scala/com/helio/services/auth/SecretField.scala:19-22` and `:27-30`.

### Verdict: REFUTE

Four of five round-1 change requests are genuinely resolved, and the storage shape, fail-closed
construction and rotation procedure are now sound. What blocks: the round-2 rotation work
introduced a `MasterKeyProvider` signature that contradicts Decision 1's own description of the
seam and structurally defeats the KMS-swap property the ticket mandates; the signature as written
is not valid Scala 2.13; and CR4's ambiguity survives in `proposal.md` and in a code comment no
task updates.

### Change Requests

1. **`MasterKeyProvider` as specified cannot support the KMS swap Decision 1 promises (blocking).**
   Decision 1 says the seam is "deliberately narrow — `wrap`/`unwrap` a data key, given a key id —
   so a `KmsMasterKeyProvider` can be substituted later with **no** change to
   `EncryptedSecretBackend`, the repository, or any caller." But Decision 3's actual signature
   hands raw key material to the caller:
   `def current(): Either[MasterKeyError, (keyId: String, key: MasterKey)]` and
   `def forKeyId(keyId: String): Either[MasterKeyError, MasterKey]` — no `wrap`/`unwrap` method
   exists anywhere in design.md or tasks.md, so the wrapping must happen in
   `EncryptedSecretBackend` using the returned `MasterKey` bytes. That is exactly what a KMS-backed
   provider cannot do: Decision 1 itself states KMS's value is that "no key material ever leaves
   KMS", so `forKeyId` could never return a `MasterKey` and the swap would require reshaping
   `EncryptedSecretBackend` — contradicting both Decision 1 and the ticket's binding given ("The
   `SecretBackend` seam must be designed so a KMS-backed implementation can be added later without
   redesigning callers"). Resolve by moving the wrap/unwrap operation behind the provider, e.g.
   `def wrapDataKey(dataKey: Array[Byte]): Either[MasterKeyError, (String, WrappedKey)]` (returning
   the active `key_id`) and `def unwrapDataKey(keyId: String, wrapped: WrappedKey): Either[MasterKeyError, Array[Byte]]`,
   with `MasterKey` never crossing the trait boundary. Mirror the new signature in `tasks.md` 2.1
   and 3.1, and update Decision 5 step 3 (which currently says "unwrap … via
   `provider.forKeyId(row.key_id)`, re-wrap under `provider.current()`'s key") and `tasks.md` 5.2
   to the chosen surface. If instead you deliberately keep raw-key-returning providers, then say so
   and strike the "no change to `EncryptedSecretBackend`" claim from Decision 1 — but that
   contradicts a ticket given, so the first option is the one to take.

2. **The `current()` signature is not valid Scala 2.13 (blocking, cheap).** `design.md` Decision 3
   writes `Either[MasterKeyError, (keyId: String, key: MasterKey)]`. Named tuple elements are Scala
   3.7+ syntax; this repo is Scala 2.13.15 (`backend/build.sbt:1`). Restate as a named case class
   (e.g. `final case class ActiveMasterKey(keyId: String, key: MasterKey)`) — or as whatever CR 1's
   revised surface returns — so the design is transcribable as written.

3. **`proposal.md` still contradicts Decision 3a (blocking — this is round-1 CR4, unresolved in
   this artifact).** `proposal.md` "What Changes", first bullet: "Add an application-layer
   envelope-encryption helper (`EncryptedSecretBackend`) implementing the existing `SecretBackend`
   seam (`SecretField.scala`, HEL-460)". `design.md` Decision 3a: "`EncryptedSecretBackend` is a
   **separate trait**, not a `SecretBackend` implementation". `proposal.md`'s "Modified
   Capabilities" note compounds it ("this adds a new implementation"). Rewrite both to Decision 3a's
   wording — a standalone trait living beside `SecretField.scala` in `com.helio.services.auth`,
   leaving `SecretBackend`/`SecretRedaction` untouched.

4. **A shipped code comment will be left asserting the opposite; no task fixes it.**
   `backend/src/main/scala/com/helio/services/auth/SecretField.scala:19-22` states "HEL-536 owns
   every non-inline backend (GCP Secret Manager references, envelope encryption) and **will add its
   own `SecretBackend` implementation behind this interface**", and `:27-30` repeats it. Under
   Decision 3a that becomes false the moment this change lands, and nothing in `tasks.md` §1–§6
   touches that file. Add a task to update both scaladoc blocks to point at
   `EncryptedSecretBackend` as a sibling trait (with the one-line reason: `mask` is total and
   infallible, encryption must be able to fail), so the seam's own documentation matches the
   decision.

### Non-blocking notes

- Still open from round 1, still worth taking: no `UNIQUE (user_id, name)` on
  `connector_credentials` (HEL-821 will look credentials up by owner+label); and consider binding
  AES-GCM AAD (`id` ‖ `user_id` ‖ `key_id`) on both layers so a ciphertext/wrapped-key pair cannot
  be transplanted between rows or users and still authenticate. Both are cheap now,
  migration-shaped later.
- Decision 3's "Outside a rotation window only one key is ever configured, so `forKeyId` only ever
  succeeds for the current id" is correct but worth an explicit test alongside `tasks.md` 3.3 —
  `forKeyId("some-retired-id")` must return `Left(UnknownKeyId)`, not fall through to the current
  key.
- `tasks.md` 2.2/2.3 document `CONNECTOR_MASTER_KEY_ID` as required in every environment; make sure
  the CLAUDE.md row says so plainly, since a missing `_ID` with a present key is a fail-closed
  condition an operator would otherwise hit by surprise.
