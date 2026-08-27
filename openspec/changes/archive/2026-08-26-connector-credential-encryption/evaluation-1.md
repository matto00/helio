## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- All ticket acceptance criteria addressed explicitly:
  - Ciphertext-at-rest with DB-level assertion: `ConnectorCredentialRepositorySpec.scala` "persist
    ciphertext ... task 4.2" queries `connector_credentials` directly on the privileged pool via
    `encode(ciphertext, 'escape')`, bypassing the repository, and asserts `should not be plaintext`
    / `should not include plaintext`.
  - Round-trip tested (`EncryptedSecretBackendSpec`, `ConnectorCredentialRepositorySpec`).
  - Wrong/rotated master key handling tested (both unit and integration level).
  - RLS owner scoping proven under a genuinely non-bypassing role (`helio_app_test`), same topology
    as `RlsOwnerTablesSpec`.
  - Master-key rotation documented executably at `docs/secrets-inventory.md`, and implemented as
    `rewrapAllBelow` + `RewrapConnectorCredentialsJob`.
  - `sbt compile test` verified green independently (see Phase 2).
  - Fail-closed-on-missing-key: `MasterKeyProvider.wrapDataKey` returns
    `Left(NoKeyConfigured)` → `EncryptedSecretBackend.encrypt` returns `Left` →
    `ConnectorCredentialRepository.create` never inserts, and the integration test explicitly
    asserts row count unchanged before/after (task 3.2 / 4.2 combined test).
  - Local dev/CI path uses the same `CONNECTOR_MASTER_KEY` env var, no dev/prod branch in
    `EnvMasterKeyProvider` — confirmed by reading the file; no `sys.env` conditional on environment
    anywhere in the new code.
- No AC silently reinterpreted; no scope creep — no HTTP routes were added (ticket is explicit that
  this ships no client-facing surface), `RewrapConnectorCredentialsJob` is exactly the task-5.2
  maintenance script called for, not gold-plating.
- All task items (tasks.md) match what was actually implemented; spot-checked each `[x]` against
  the diff.
- No regressions to existing behavior: `SecretField.scala`'s scaladoc update (task 3.5) is
  documentation-only, no code path changed; `SecretBackend`/`SecretRedaction` callers untouched.
- No GCP resources provisioned; `docs/secrets-inventory.md` and CLAUDE.md both explicitly document
  Secret Manager wiring as the operator's manual step, matching the ticket's "Out of Scope" line.
- No API contract/schema changes needed (no routes added) — correctly not touched.
- Planning artifacts (design.md, tasks.md) match the final implementation; V92 migration matches
  Decision 2's SQL verbatim (column names, RLS policy, index).

Issues: none.

### Phase 2: Code Review — PASS

Ran `npm run check:scala-quality` myself: clean (136 pre-existing soft file-size warnings elsewhere
in the codebase, none in the new files — `ConnectorCredentialRepositorySpec.scala` at 295 lines is
close to the 250-line soft budget for a test file but this is informational-only per
`CONTRIBUTING.md:142`, and matches the size of comparable existing specs like
`RlsOwnerTablesSpec.scala`). No inline-FQN violations.

Ran `cd backend && sbt compile test` myself (fresh run, ~3m10s): **3490 tests, 0 failures**,
"All tests passed", `[success]`.

- **Canonical code-quality compliance**: imports are all top-of-file (`MasterKeyProvider.scala`,
  `EncryptedSecretBackend.scala`, `ConnectorCredentialRepository.scala` — no inline FQNs found,
  confirmed by the clean `check:scala-quality` run). Value-class ID pattern followed
  (`ConnectorCredentialId`). No route boundary exists yet so the "wrap path-extracted IDs at the
  route boundary" rule doesn't apply.
- **Design-standard mechanical rules**: N/A — no `frontend/**` files changed.
- **DRY**: `EncryptedSecretBackend` reuses `EnvMasterKeyProvider.gcmEncrypt`/`gcmDecrypt` rather than
  duplicating AES-GCM boilerplate for the value-encryption layer — good reuse across the two
  encryption layers (data-key wrap vs. value encrypt).
- **Readable**: naming is clear (`wrapDataKey`/`unwrapDataKey`/`decryptForUse` vs. `get`/`list`),
  magic values (nonce length 12, tag length 128, data-key length 32) are named constants, not
  scattered literals.
- **Modular**: `MasterKeyProvider` (trait + env impl), `EncryptedSecretBackend`,
  `ConnectorCredentialRepository`, and `RewrapConnectorCredentialsJob` are cleanly separated by
  concern; `EncryptedSecretBackend` doesn't know about Postgres, the repository doesn't know
  cryptographic details beyond opaque `EncryptedPayload`.
- **Type safety**: no `asInstanceOf`/`.get`-on-Option escape hatches in the new production code;
  `Either[MasterKeyError, _]` used consistently for fallible operations.
- **Security**: AES-256-GCM (authenticated encryption) for both layers; random 96-bit nonces per
  encrypt call; master key never touches the DB; `key_id` is an operator label, not derived from key
  material, so it carries no side-channel. `EncryptedPayload.toString` is redacted proactively.
- **Error handling**: fail-closed by construction — `create` checks `encrypt`'s `Left` before any DB
  write; `decryptForUse` never returns a corrupted-plaintext success; `RewrapConnectorCredentialsJob`
  exits nonzero if `CONNECTOR_MASTER_KEY_ID` is unset rather than silently no-op'ing.
- **Tests meaningful**: exercises the true DB round-trip (embedded Postgres + Flyway), a real
  non-bypassing RLS role, and negative paths (no key, wrong key, unknown key id) that would catch a
  real regression (e.g. reverting the `Left`-before-write ordering in `create` would fail the 4.2/3.2
  combined test).
- **No dead code**: no unused imports, no leftover TODO/FIXME in the new files.
- **No over-engineering**: `MasterKeyProvider`'s `wrap`/`unwrap` seam is exactly as narrow as
  design.md calls for (no premature KMS abstraction beyond the trait boundary).
- **Behavior-preserving where expected**: `SecretField.scala`'s edit is scaladoc-only; verified via
  diff that no method signature or logic changed.

Specific strict-evidence checks (per the user's stated stricter standard for this ticket):

1. **DB-level plaintext assertion, verified myself, not just read**: re-ran
   `ConnectorCredentialRepositorySpec` as part of the full `sbt test` run above; it passed. I also
   independently read the assertion logic (`rawCiphertextText should not be plaintext` /
   `should not include plaintext` against `encode(ciphertext, 'escape')` queried on the privileged
   pool, bypassing the repository) and confirm it is a genuine DB-level, not code-level, check.
2. **Fail-closed test asserts zero rows persisted**: confirmed —
   `ConnectorCredentialRepositorySpec.scala` "fails closed and persists zero rows when no master key
   is configured (task 3.2 / repository level)" queries `COUNT(*)` before and after the failed
   `create` call and asserts `after shouldBe before`, not merely that `create` throws.
3. **Wrong/rotated master-key path tested**: confirmed at both unit level
   (`EncryptedSecretBackendSpec` "fail closed (Left) when only a different (unrelated) key is
   configured", "return Left(UnknownKeyId) when the payload's key_id matches neither...") and
   integration level (rotation re-wrap test in `ConnectorCredentialRepositorySpec`).
4. **Cross-user RLS denial under a non-bypassing role**: confirmed —
   `ConnectorCredentialRepositorySpec` builds a second Hikari pool with
   `SET ROLE helio_app_test` (a `NOSUPERUSER` role, not `helio_privileged`/`postgres`), mirroring
   `RlsOwnerTablesSpec.scala:20-60`'s exact technique. The cross-user test queries via
   `ctx.withUserContext(ownerB.value)` on the app pool (non-bypassing) for a row that belongs to
   ownerA and asserts `rows shouldBe empty`. This structurally distinguishes RLS-enforced from
   RLS-bypassed reads — the HEL-488 near-miss does not apply here.
5. **`sbt compile test` green, run myself**: yes — see above, 3490/3490 passed.
6. **CLAUDE.md documents `CONNECTOR_MASTER_KEY` (+ `_ID`/`_PREVIOUS`/`_PREVIOUS_ID`)**: confirmed,
   4 rows added at CLAUDE.md:63-66, matching the existing table's style (Variable/Required/
   Description columns, cross-references HEL-536 and `docs/secrets-inventory.md`).
7. **No plaintext reachable from an API response**: confirmed structurally —
   `ConnectorCredentialMeta` (model.scala:80-87) has exactly
   `id/userId/name/keyId/createdAt/updatedAt`, no plaintext/ciphertext field; `get`/`list` return
   this type exclusively; only `decryptForUse` (distinctly named, doc'd as never to be called from a
   route handler) returns a raw `String`. No route in this ticket calls it. Test
   `ConnectorCredentialRepositorySpec` "return metadata containing no plaintext/value field"
   additionally asserts `meta.productElementNames.toSet` equals exactly that six-field set.
8. **`EncryptedSecretBackend` does NOT extend `SecretBackend`**: confirmed by reading
   `EncryptedSecretBackend.scala:29` — `final class EncryptedSecretBackend(provider:
   MasterKeyProvider)` has no `extends SecretBackend` clause; it's a standalone class, matching
   design.md Decision 3a.
9. **No GCP resources provisioned; no silent production-Secret-Manager assumption locally**:
   confirmed — `EnvMasterKeyProvider` reads only `sys.env`, no Secret Manager client code anywhere
   in the new files; `docs/secrets-inventory.md` explicitly marks Secret Manager secret creation and
   `infra/deploy-backend.sh` wiring as "Provisioning still required" (operator action), and
   `docs/cloud-dev-setup.md` documents a local `.env` value via `openssl rand -base64 32`.

Issues: none.

### Phase 3: UI Review — N/A

No UI-affecting files changed. This ticket adds no HTTP routes (explicitly out of scope — it is a
storage substrate consumed later by HEL-821), no `frontend/**` changes, no `ApiRoutes.scala` change,
no `schemas/**` change, no `openspec/specs/**` (non-change-scoped) change. Confirmed via
`git diff --name-only main...HEAD`: only backend Scala files, `CLAUDE.md`, and two docs files
changed. Dev-server startup / browser review is not applicable and was not run.

### Overall: PASS

### Non-blocking Suggestions

- `ConnectorCredentialRepositorySpec.scala` (295 lines) is just past the 250-line informational soft
  budget for source files; not a blocker (comparable to existing specs like `RlsOwnerTablesSpec`),
  but worth a proactive split if this file grows further in HEL-821.
