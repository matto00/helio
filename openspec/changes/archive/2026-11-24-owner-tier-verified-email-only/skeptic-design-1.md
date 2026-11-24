## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD d4e59f00629852df6debf9cc988c0c8a183483a4 (the change dir is untracked; artifacts read from disk).
Lane constraints obeyed: no `.env*` file was read; the real owner address was masked (`<ADDR>`) in every
command output; no gcloud.

### What I verified (with evidence)

- **Owner-assignment enumeration is complete.** `git grep -n "isOwnerEmail\|UserTier.Owner"` over
  `backend/src/main`: the only writes are `AuthService.scala:120` (register), `AuthService.scala:229-230`
  (`promoteIfAllowlisted` via `updateTier`), `UserRepository.scala:86-87` (Google returning) and `:96`
  (Google new). Every other hit only reads the tier. Raw-SQL writes to `users`
  (`git grep -i "update users\|into users"`): `InviteCodeRepository.scala:39` (`tier = 'beta'` only, guarded
  `AND tier = 'free'`), `UserPreferenceRepository.scala:161/165` (preferences), `V10` (system user, no tier).
  Migrations: only `V88` mentions `'owner'` (the CHECK constraint). `updateTier`'s only caller is
  `AuthService.scala:230`. `findByEmail`'s only callers are `AuthService` register/login. No MFA, PAT, MCP or
  invite path writes Owner. Design D3 removes every password-path write, so no password signup/login can
  yield Owner after the change.
- **Constraint name.** `V6__users.sql:3` is `email TEXT UNIQUE NOT NULL` → Postgres default `users_email_key`;
  no later migration renames it, adds another email index, or references `users(email)` as an FK
  (`git grep -i "references users *(email\|users_email\|ON CONFLICT (email)"` = 0 hits), so the
  `DROP CONSTRAINT` without `IF EXISTS` is sound and will fail loudly on drift.
- **Non-superuser Flyway.** `users` has no RLS (no `ENABLE/FORCE ROW LEVEL SECURITY` on it in any
  migration), so the `UPDATE` cannot be silently filtered; `V88` already `ALTER TABLE users` in prod under the
  same role, so `helio` owns the table. `FlywayNonSuperuserMigrationSpec` exists and the plan keeps it green.
- **Transactionality.** D2 uses a plain (non-`CONCURRENTLY`) `CREATE UNIQUE INDEX` and a `DO ... RAISE`, so
  the migration runs in one Flyway transaction and a raise rolls everything back. V148 is the next free
  number (V147 is latest; no sibling worktree has V148).
- **Google userinfo.** `OAuthRoutes.scala:84` fetches `https://www.googleapis.com/oauth2/v3/userinfo` with
  scope `openid email profile` (`:175`); the v3 (OIDC) endpoint returns `email_verified` as a JSON boolean
  (the legacy v2 field is `verified_email`). The reader at `AuthProtocol.scala:75-84` drops it today. D4's
  lenient reader (missing/non-true → false, never throws) is correct.
- **Secret switch.** `cd-backend.yml:101` carries the literal in `--update-env-vars`; `deploy-backend.sh:123`
  interpolates `${HELIO_OWNER_EMAILS}` in `--set-env-vars`; there is no `:?` required check for it (D6's
  "drop any" is therefore a no-op, fine). D6 correctly identifies that Cloud Run rejects a literal→secret
  type change and routes it to a one-time owner step, disclosed as unverified. `helio-backend-sa` is the
  real SA (`deploy-backend.sh:122`, `docs/secrets-inventory.md:26`). No other workflow sets the variable.
- **Guard CI wiring.** `ci.yml` `frontend` job has no path filter and already runs
  `check:cloud-run-cpu[:selftest]` (`ci.yml:57-58`); its own comment (`ci.yml:42-49`) records that wiring
  `.husky/**` trips the gate-chain-change requirements, which D7 avoids. Adding steps to an existing job
  does not touch `ci-complete` needs.
- **Delta specs vs canonical.** MODIFIED requirement headers match the canonical names exactly
  (`user-tier-model` "Config-driven owner-email allowlist", `email-password-auth` "User registration"/"User
  login", `google-oauth-login` "Google OAuth callback — successful login"); every canonical scenario is
  carried forward; the two canonical lines holding the real address (`user-tier-model/spec.md:33,44`) are
  inside the replaced requirement, so archive sync removes them.
- **Rulings honoured.** 1a (one normaliser), 1b (fail-loud, no merge), 1c (verified Google only, no
  demotion, HEL-1856 split stated), 2 (secret name, `--update-secrets`/`--set-secrets`, CLAUDE.md row only,
  secrets-inventory, BetaAccessService recipients unchanged) all map to D1–D8.

### Verdict: REFUTE

Two small but real defects: an internal contradiction in the normalisation definition, and two ticket ACs
with no producing task.

### Change Requests

1. **D1 and D2 define "trim" differently (internal contradiction).** D1's normaliser is Java `String.trim`
   (strips every char `<= U+0020`: tab, CR, LF, other controls). D2's migration uses Postgres
   `btrim(email)`, which strips only spaces. `RequestValidation.EmailRegex` (`RequestValidation.scala:8`,
   `^[^@]+@[^@]+\.[^@]+$`) admits tabs/newlines, so a stored `a@x.co<TAB>` survives V148 untrimmed while
   the app's lookup normalises input to `a@x.co`: V148's duplicate check misses a `a@x.co` / `a@x.co<TAB>`
   pair (both rows kept, both indexable), and the email-normalization spec's "every stored email equals
   its trimmed lower-case form" is false for such rows. Revise D1/D2 so the migration's duplicate-check
   expression, its `UPDATE` expression and the Scala normaliser trim the same character set (e.g. pick
   `strip`/`trim` semantics once and implement the identical class in SQL with `regexp_replace`, or make
   the normaliser space-only to match `btrim`), and add a 1.3 migration-spec case with a non-space
   whitespace duplicate. While there, state in D1 that Postgres `lower()` (collation-dependent) and Java
   `toLowerCase(Locale.ROOT)` can differ on non-ASCII input the regex admits, and either restrict the
   claim to ASCII or say why the residual divergence is harmless (it cannot grant Owner after D3).
2. **Two ticket ACs have no producing task.** AC "a migration adds a unique index ... after checking prod for
   existing case-duplicates" and AC "a one-time check lists prod users with Owner tier" are routed to the
   owner's "Before release" steps (correct per the rulings), but no task authors what the owner runs, and
   tasks.md has no item for the "Before release" section at all. Add a task that writes, in the change dir
   (e.g. `release-checklist.md`, evaluator-checkable), in the ruling's order: (a) create
   `helio-owner-emails`; (b) grant `helio-backend-sa` `roles/secretmanager.secretAccessor`; (c) the exact
   read-only duplicate-check SQL, using the **same expression as V148's `DO` block** so a clean check
   guarantees V148 will not raise; (d) the exact Owner-tier listing SQL (id, email, created_at,
   `google_id IS NOT NULL`, `password_hash IS NOT NULL`, so a password-only Owner row — the attack's
   signature — stands out); (e) the one-time literal→secret switch, marked unverified (C8); (f) then tag.
   State which HEL-1856 part is covered (owner grant only) in the same file for the PR body.

### Non-blocking notes

- D7/spec mismatch to settle in implementation: the production-deployment-docs scenario says the guard
  passing implies "both deploy paths map `HELIO_OWNER_EMAILS` to `helio-owner-emails:latest`", but D7 only
  describes negative checks. Either have the guard also assert the positive secret mapping (cheap, and it
  stops a silent drop of the allowlist) or reword the scenario.
- D7 must scope the `@` scan to the env-vars flag values only: `deploy-backend.sh:122`'s
  `--service-account=helio-backend-sa@...` contains an `@` and would false-positive a whole-command scan.
- D6: consider documenting the atomic form (`--remove-env-vars=HELIO_OWNER_EMAILS` together with
  `--update-secrets=HELIO_OWNER_EMAILS=helio-owner-emails:latest` in one `services update`) as the
  preferred owner step, with the two-step form as fallback, to avoid a window where the allowlist is unset
  (BetaAccess notifications 503 in that window).
- D5 note: a Google first sign-in whose email case-matches an existing password row now hits the unique
  index (previously only an exact match did); confirm the callback's existing "unexpected internal failure"
  handling renders it, not an unhandled 500 body. Behaviour change itself is HEL-1856's, as stated.
