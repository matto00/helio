## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Artifacts read in full**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/connector-credential-encryption/spec.md`.
- **V92 is genuinely free** — `ls backend/src/main/resources/db/migration/` shows the high-water
  mark is `V91__audit_events.sql`. Design's claim (and its call-out that the ticket's "V59" is
  stale) is accurate.
- **RLS pattern claim is accurate** — `V35__*.sql` and `V42__*.sql` read directly. V42 (`api_tokens`)
  is byte-for-byte the pattern Decision 2 proposes: `user_id UUID NOT NULL REFERENCES users(id) ON
  DELETE CASCADE`, `CREATE INDEX idx_..._user_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, single
  `USING (user_id = current_setting('app.current_user_id')::uuid)` with no `WITH CHECK`, and V42's
  own comment confirms design's reasoning verbatim: "With no WITH CHECK clause the USING expression
  also gates INSERT". V42 also confirms the `helio_privileged`/V38 `ALTER DEFAULT PRIVILEGES`
  inheritance claim. Design's SQL is sound and correctly grounded.
- **`DbContext.withUserContext` exists and behaves as described** —
  `backend/src/main/scala/com/helio/infrastructure/persistence/DbContext.scala:50-51`
  (`db.run((setUserVar(userId) andThen action).transactionally)`), app pool vs. privileged
  BYPASSRLS pool documented in-file. (Note: the path is `infrastructure/persistence/`, not the
  `db/` some prose implies — cosmetic.)
- **`SecretField.scala` seam read in full** — `SecretField`/`HasSecrets`/`SecretBackend`/
  `InlineSecretBackend`/`SecretRedaction` are as design describes. `SecretBackend` today is exactly
  `def mask(rawValue: String): String`, and its scaladoc explicitly reserves this ticket's work:
  "HEL-536 owns every non-inline backend ... and will add its own `SecretBackend` implementation
  behind this interface without reshaping `SecretRedaction.redact`'s call sites."
- **A proven non-superuser RLS test harness already exists** —
  `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala:20-60`
  creates a `helio_app_test` non-superuser role on EmbeddedPostgres precisely to defeat the
  superuser-BYPASSRLS problem. Task 4.3 is therefore feasible.
- **`HEL-616` claim in tasks.md 6.2 checked against the repo** — `grep -rn "HEL-616"` finds it only
  in `openspec/changes/archive/2026-07-24-connection-test-endpoint/ticket.md:70`, which records it
  as "HEL-616 (**no** log-redaction guard — just filed)". No such guard exists in `scripts/` or
  `.husky/`. Re-ran the grep across the whole tree to be sure; result stable.

### Verdict: REFUTE

The storage shape, RLS grounding, fail-closed encryption construction (Decision 3) and V92 choice
are solid and ground-truth-accurate. Five items block implementation: one hard internal
contradiction between design.md and proposal.md/spec.md, a rotation story that the designed
interface cannot actually execute, a task built on a repo fact that is false, an ambiguous seam
decision with a silent-blast-radius reading, and an acceptance criterion no task covers.

### Change Requests

1. **Resolve the direct contradiction on the dev/CI key path (blocking; this is an AC).**
   `design.md` Decision 4 states "**no baked-in fallback key in code**" and that there is "no
   dev/prod branch to get wrong". But `proposal.md` says "Local dev/CI use a fixed, clearly-labeled
   development-only key; this path cannot activate in a production deployment (guarded by
   `HELIO_ENV`/prod-mode check)", and `spec.md`'s last requirement mandates "a deliberate,
   clearly-labeled **non-production master key path**" with a scenario "the backend starts in a
   non-production environment **with no production master key available** → credential
   encryption/decryption works using the designated development-only key" plus a "Development key
   cannot activate in production" scenario. Under Decision 4 that first scenario is unimplementable
   (no key configured ⇒ `encrypt` returns `Left` by construction) and the second has nothing to
   implement. An implementer can read this two ways, and the proposal's reading (a `HELIO_ENV`-gated
   in-code dev key) is exactly the leak risk the ticket's last AC forbids. Pick one — Decision 4 is
   the stronger answer — and rewrite `proposal.md`'s bullet and both `spec.md` scenarios to match
   it (e.g. "operators supply a non-production key **value** through the same single
   `CONNECTOR_MASTER_KEY` var; no development-only key exists in application code, so there is no
   dev branch that could activate in production").

2. **Make the rotation story executable with the interface actually being designed (blocking).**
   Decision 5 step 2 requires unwrapping each row's data key "under the old key (identified by its
   stored `key_id`)" and Decision 5 step 1 contemplates "running two keys concurrently", but the
   only provider surface specified anywhere is `MasterKeyProvider.current(): Either[MasterKeyError,
   MasterKey]` (Decision 3) fed by the single env var `CONNECTOR_MASTER_KEY` (task 2.1). Nothing
   defines (a) how `key_id` is derived from or associated with a key value, or (b) any way to
   resolve a master key **by** `key_id`. As written, once the env var is flipped to the new key,
   every existing row is permanently undecryptable — rotation cannot run. Specify: the `key_id`
   derivation/config, a `MasterKeyProvider.forKeyId(id): Either[MasterKeyError, MasterKey]` (or
   equivalent), and how the old key is supplied during the rotation window (e.g. a documented
   `CONNECTOR_MASTER_KEY_PREVIOUS`, or an explicitly offline one-shot re-wrap job that takes both
   keys as inputs). Add the corresponding task under §5 — today §5 has only "document", so nothing
   is built. This also blocks the future-KMS swap, which Decision 1 defines as "exactly a rotation
   event, using the same rotation mechanism": the seam is only genuinely open for KMS if a key can
   be addressed by id.

3. **Fix tasks.md 6.2 — it relies on a mechanism that does not exist.** It states "mechanical guard
   already exists for connector secrets per HEL-616; confirm the new code path is covered by it,
   don't duplicate it." Ground truth:
   `openspec/changes/archive/2026-07-24-connection-test-endpoint/ticket.md:70` lists HEL-616 as
   "**no** log-redaction guard — just filed", and no such check exists under `scripts/` or
   `.husky/`. Rewrite 6.2 into something executable — e.g. an explicit code review/grep that the
   plaintext value never reaches a log statement or a `toString`, and a redacted `toString` on
   whatever type carries the plaintext (the `EmailConfig`-style precedent design.md already cites).

4. **Pin down how `EncryptedSecretBackend` relates to `SecretBackend` (blocking ambiguity).**
   tasks.md 3.1 says it "implements `SecretBackend`'s **spirit** but adds `encrypt`/`decrypt`" —
   two readings. If it `extends SecretBackend`, it must define `mask(rawValue: String): String`,
   and any `SecretRedaction.redact(config, thisBackend)` call site would then substitute
   ciphertext/garbage where `"***"` is expected — a silent behavior change at an existing seam. If
   it does not extend it, the ticket's hard "build on the `SecretField`/`HasSecrets`/`SecretBackend`
   seam, do not invent a parallel mechanism" requirement needs an explicit statement of how the two
   relate. State the concrete shape in design.md (trait signatures, whether `SecretBackend` is
   extended, and what `mask` returns if so) and mirror it in task 3.1.

5. **Give the "decrypted values are never returned to API clients" requirement a task, or defer it
   explicitly.** It is a ticket AC and a `spec.md` requirement with a scenario, but `proposal.md`
   states "No route changes ... no client-visible API", and no task in §1–§6 covers it — so it is
   vacuously true and untraceable at the final gate. Either add a task that makes it structural
   (e.g. the repository's read API returns metadata only; plaintext is reachable only through a
   distinctly-named server-side method; a test asserting no JSON formatter exists for the plaintext
   type) or move the requirement to HEL-821 and mark it deferred in the spec.

### Non-blocking notes

- `updated_at TIMESTAMPTZ` is in the V92 DDL, but task 4.1's repository is `create`/`get`/`delete`
  only — nothing ever updates it. Either add the update/re-wrap write path (CR 2 will likely need
  it) or drop the column.
- No `UNIQUE (user_id, name)` on `connector_credentials`. HEL-821 will almost certainly look a
  credential up by owner+label; without the constraint duplicates are silently permitted.
- Consider binding AES-GCM AAD (e.g. row `id` ‖ `user_id` ‖ `key_id`) on both layers so a
  ciphertext/wrapped-key pair cannot be transplanted between rows or users and still authenticate.
  Cheap now, migration-shaped later.
- Task 4.3 points at `openspec/changes/archive/2026-08-26-audit-query-api-ui/` for the
  non-bypassing-role technique; the directly reusable harness is
  `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala:20-60`
  (`helio_app_test` non-superuser role). Cite it.
- Prose refers to "`DbContext`" generally; the file is at
  `backend/src/main/scala/com/helio/infrastructure/persistence/DbContext.scala`.
