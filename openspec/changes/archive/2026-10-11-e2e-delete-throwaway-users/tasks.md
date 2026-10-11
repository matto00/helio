## Standing Constraints

- [C1] Delete users only by exact recorded id (email as a second equality check); never a pattern, name or time-window predicate, in code or in any measurement/cleanup command.
- [C2] Never print, cat or source `backend/.env`, `DATABASE_URL`, or any credential, including in error messages and logs.
- [C3] No backend route/service/migration: the cleanup path must not exist in the product.
- [C4] Do not delete existing dev-DB residue; only users created by the executor's own measured runs (by exact id).

### Tests (red first)

- [x] 1.1 Measure "before" on the base commit: snapshot user ids, run the full e2e suite (2 workers, nice -n 19), snapshot again; record the exact set difference and attribution in `measurements.md` in the change dir (read-only)
- [x] 1.2 Write the builder selftest first and show it red against a stub (missing module/refusals) before implementing

### Harness

- [x] 2.1 Extract `e2e/support/db.ts` (env then `backend/.env` resolution, psql runner whose error carries only bounded stderr); switch `historySeed.ts` to it; verify `check:e2e-types` and a historySeed spec pass
- [x] 2.2 Add `e2e/support/userCleanup.ts` (teardown transaction sets a `lock_timeout` so it fails fast, never hangs a shard): registry path from env (throws if unset), `recordCreatedUser({id,email})`, pure `buildUserDeleteSql(records)` per design D3/D4, `deleteRecordedUsers(dir)`; verify selftest green
- [x] 2.3 Add globalSetup (fresh dir, refuse non-empty)/globalTeardown and wire them once in `playwright.config.ts` (confirm the regression config inherits it); gitignore `/.e2e-user-registry/`; verify a one-spec run leaves no registry dir and no user
- [x] 2.4 Make `registerUser` record `user.id`/`user.email` from the 201 body (record only on 201); verify a spec using `registerAndLogin` records its user

### Call sites

- [x] 3.1 Record every direct `POST /api/auth/register` site (14 files incl. quarantined ones) and the UI signup in `auth-cookie-migration.spec.ts` (from the register response it already awaits), and `hel503`'s wrapper; verify `rg` shows no unrecorded site
- [x] 3.2 Add `scripts/check-e2e-user-cleanup.mjs` + selftest (mutation-failable; signup-form signal is concrete and has its own selftest case), npm scripts, CI lines next to `check:e2e-evidence-paths`, `.husky/pre-commit` lines; verify `check:precommit-ci-parity` passes

### Verification

- [x] 4.1 Selftest mutation proof: disable each refusal (UUID check, system-user refusal, email check, domain/owner refusal in builder and SQL, own-run-dir isolation, FOR UPDATE lock present, count assertion) one at a time and show the selftest goes red; record in `measurements.md`
- [x] 4.5 Credential-leak probe: force a psql failure with a sentinel URL/password; neither appears in thrown or logged output; red when `${e}` interpolation is restored
- [x] 4.2 DB-level guard proof against a real DB: a record whose email mismatches its id aborts with zero rows deleted (use a user created for the proof, deleted afterwards by exact id)
- [x] 4.3 Measure "after" on the branch: full e2e suite as in 1.1; the run's recorded ids remaining = 0; record counts and run time delta of teardown in `measurements.md`
- [x] 4.4 Document the registry, teardown and leftover-registry recovery in `e2e/README.md`; run lint, format:check, check:e2e-types, the new checks, and the pre-commit hook
