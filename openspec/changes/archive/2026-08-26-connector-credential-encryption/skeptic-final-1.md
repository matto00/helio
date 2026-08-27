## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

Cold pass, derived from the diff and from running the code myself; the evaluator's
report was read only as a set of claims.

**Full backend suite, re-run by me** (`cd backend && sbt -batch test`):
```
[info] Run completed in 3 minutes, 9 seconds.
[info] Total number of tests run: 3490
[info] Suites: completed 222, aborted 0
[info] Tests: succeeded 3490, failed 0, canceled 0, ignored 0, pending 0
[success] Total time: 191 s
```
**Targeted re-run** of `EncryptedSecretBackendSpec` + `ConnectorCredentialRepositorySpec`:
17 tests, all named cases pass (`Suites: completed 2, aborted 0`).
**Scala code-quality gate** (`npm run check:scala-quality`): `clean (136 soft warning(s))`.
No `frontend/**` or `e2e/**` file in `git diff main...HEAD --name-only` → UI/design
gate is N/A; servers not started.

**AC 1 — DB-level ciphertext proof.** `ConnectorCredentialRepositorySpec` "persist
ciphertext at the storage layer…" bypasses the repository and issues raw
`sql"SELECT encode(ciphertext, 'escape') FROM connector_credentials WHERE id = …"`
on the privileged pool, asserting `not be plaintext` **and** `not include plaintext`.
This is a real storage-layer read, not a code-level assertion. **Met.**

**AC 2 (partial) — round-trip.** `decryptForUse` round-trip test + backend-level
round-trip both pass. **Met.** Wrong/rotated-key half: see CR1.

**AC 3 — fail-closed on missing master key.** Verified at both layers.
`EncryptedSecretBackend.encrypt` returns `Left(NoKeyConfigured)` with an empty env,
and separately when the key is set but `_ID` is missing. At the repository layer the
test asserts `an[ConnectorCredentialEncryptionFailed] should be thrownBy` **and**
compares `SELECT COUNT(*)` before/after — zero rows persisted, exactly the bar you
set. Structurally sound too: `create` matches on `secretBackend.encrypt(plaintext)`
and returns `Future.failed` *before* constructing or inserting any row
(`ConnectorCredentialRepository.scala:38-41`). There is no code path from "no key"
to a persisted row. **Met.**

**AC 4 — RLS under a genuinely non-bypassing role.** This is the HEL-488 trap and
the test avoids it. The spec builds two HikariCP pools over the same embedded
Postgres with `connectionInitSql` `SET ROLE helio_app_test` (created
`NOSUPERUSER … NOLOGIN`, no `BYPASSRLS`) and `SET ROLE helio_privileged`
(`BYPASSRLS`). Postgres evaluates row security against `current_user`, which
`SET ROLE` changes, and V92 sets `FORCE ROW LEVEL SECURITY`, so the table owner is
not exempt either. The denial query is raw SQL with **no user predicate** —
`sql"SELECT id FROM connector_credentials WHERE id = ${metaA.id.value}::uuid"` run
under `withUserContext(ownerB)` — so it cannot be satisfied by app-level filtering;
it returns rows iff RLS is off. The discriminator is live in the same spec: the
identical table read on the privileged pool (`withSystemContext`) *does* see other
users' rows in the ciphertext test. **Met, and structurally non-vacuous.**

**AC 6 / Decision 4 — no dev-only branch.** `EnvMasterKeyProvider` reads
`CONNECTOR_MASTER_KEY[_ID][_PREVIOUS][_PREVIOUS_ID]` from an injected `Map`
defaulting to `sys.env`, with no environment conditional and no baked-in fallback
key anywhere in the file. Confirmed by reading the whole file. **Met.**

**Decision 3a — `EncryptedSecretBackend` does not extend `SecretBackend`.** Confirmed:
`final class EncryptedSecretBackend(provider: MasterKeyProvider)` with no `extends`;
`SecretBackend`'s `mask` contract and its call sites are untouched apart from the
scaladoc correction in `SecretField.scala`. **Met.**

**`MasterKeyProvider` boundary shape.** The trait exposes only
`wrapDataKey(Array[Byte])` / `unwrapDataKey(WrappedKey)`; no method returns or accepts
master-key material, and key resolution/`SecretKey` construction is private to
`EnvMasterKeyProvider`. A KMS implementation could satisfy it with key bytes never
leaving KMS. **Met.**

**No plaintext reaches a serializable type.** `ConnectorCredentialMeta` has exactly
`id/userId/name/keyId/createdAt/updatedAt` (asserted at runtime in the spec via
`productElementNames`). `grep -rn "ConnectorCredential" backend/src/main/scala` returns
only the model, the repository, and the maintenance job — no route file, no
`JsonProtocols` formatter. The single plaintext path is `decryptForUse`, returning a
bare `String`. **Met.**

**Env-var documentation.** `CLAUDE.md` prod table rows 63–66 document all four vars
(`CONNECTOR_MASTER_KEY`, `_ID`, `_PREVIOUS`, `_PREVIOUS_ID`) with fail-closed semantics;
`docs/cloud-dev-setup.md` adds the `.env` lines plus an `openssl rand -base64 32`
substitution. **Met.**

**Rotation runbook vs. Decision 5, and executability.** `docs/secrets-inventory.md`
steps 1–5 match design.md Decision 5 step-for-step. Step 3's
`sbt "runMain com.helio.maintenance.RewrapConnectorCredentialsJob"` names an object
that actually exists and compiles, wires `EnvMasterKeyProvider`/`DbContext`, refuses
to run with `exit(1)` when `CONNECTOR_MASTER_KEY_ID` is unset, and delegates to
`rewrapAllBelow`, whose behavior is proven end-to-end by the `rewrapAllBelow` spec
(seed under old key → rotate → `key_id` updated in DB → value still decrypts under
the new key alone). Step 4's verification query is real SQL against the shipped
schema. **Executable, not just prose.**

**No GCP provisioning / no assumed Secret Manager access.**
`git diff main...HEAD --name-only -- infra .github` is empty. Nothing in the code
reads Secret Manager; it reads env vars only, and the "Provisioning still required"
section enumerates what the operator must do. **Met.**

### Verdict: REFUTE

One real coverage gap in the area the ticket itself calls its most important, plus one
trivial standard violation. Everything else above verifies clean.

### Change Requests

1. **The wrong-key-material fail-closed path (`MasterKeyError.UnwrapFailed`) has zero
   test coverage anywhere in the repo.** `grep -rn "UnwrapFailed" backend/src/test/`
   returns nothing. Both "wrong key" tests
   (`EncryptedSecretBackendSpec` — "fail closed (Left) when only a different (unrelated)
   key is configured…" and "return Left(UnknownKeyId)…") use a **different `key_id`**, so
   `unwrapDataKey` short-circuits at id resolution and returns `UnknownKeyId` **before any
   cryptography runs**. The GCM authentication-tag check is the only thing that stands
   between wrong key material and corrupted/garbage plaintext, and nothing exercises it.
   That leaves your bar (3) unproven for the most likely real operator error: the key
   value is replaced (or an old Secret Manager version restored) while
   `CONNECTOR_MASTER_KEY_ID` stays the same. A later refactor loosening
   `MasterKeyProvider.scala:110-113`'s strict id matching into "try current, then previous"
   would also pass the current suite silently.
   Add to `EncryptedSecretBackendSpec`:
   (a) encrypt under key A with `CONNECTOR_MASTER_KEY_ID=env-same`, then decrypt with
   **different key bytes under the same id `env-same`** — assert
   `Left(MasterKeyError.UnwrapFailed)` specifically (not merely `isLeft`), proving the
   failure comes from GCM authentication and not from id resolution;
   (b) a tamper case — flip a byte of `payload.ciphertext` (and separately of
   `payload.wrappedDataKey`) under the correct key and assert `Left`, never a
   partial/garbled `Right`.

2. **Inline fully-qualified name**, `backend/src/main/scala/com/helio/services/auth/EncryptedSecretBackend.scala:93`:
   `new javax.crypto.spec.SecretKeySpec(bytes, "AES")`. CONTRIBUTING.md's
   "Imports & Qualifiers" rule bans this (the mechanical `check:scala-quality` prefix list
   doesn't cover `javax.`, so it slipped the gate — the rule still binds). The sibling file
   `MasterKeyProvider.scala` already imports `SecretKeySpec` at the top; do the same here.
   (`java.sql.Timestamp` in `ConnectorCredentialRepository.scala:160-161` is the established
   repo-wide `MappedColumnType` convention — not a finding.)

### Non-blocking notes

- `EnvMasterKeyProvider.wrapDataKey` maps an *encryption* failure to
  `MasterKeyError.UnwrapFailed` (`MasterKeyProvider.scala:103`). Correct fail-closed
  behavior, misleading name on the wrap path; consider a `WrapFailed` case (or a shared
  `CryptoFailed`) when this is next touched.
- No AAD binding: the value layer is encrypted with no additional authenticated data, so
  ciphertext columns are not cryptographically bound to their `id`/`user_id`. An attacker
  with direct DB write access could swap ciphertext+nonce between rows undetected. Out of
  this ticket's threat model (that attacker already owns the table), but worth binding
  `user_id`/`id` as AAD when HEL-821 puts real credentials behind it.
- `rewrapAllBelow` launches all row updates eagerly in parallel and `Future.sequence`
  fails fast, so a single unresolvable row aborts the job after some rows have already
  been re-wrapped. That's recoverable (re-running is idempotent — already-rewrapped rows
  no longer match `key_id =!= currentKeyId`), but the runbook could say so explicitly.
- `DbContext`'s scaladoc asks that every `withSystemContext` call site carry an inline
  comment justifying the bypass; `rewrapAllBelow`'s three call sites justify it in the
  method scaladoc instead. Adequate, but an inline note would match the convention.
