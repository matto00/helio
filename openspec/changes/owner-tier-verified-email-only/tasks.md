## Standing Constraints

- [C1] Never read, grep, print, copy or edit any `.env*` file (including `infra/.env.deploy.example`); never run env-dumping commands. Never print, write or commit the real owner address anywhere (tests use `owner@example.test`-style fake addresses); list files that contain it by path only (`git grep -l`).
- [C2] No gcloud, no prod, no secret creation, no release, no concertino sync.
- [C3] Red first with mutations: commit the red run (as `.txt`) before implementation code; every AC test is shown failable by a named mutation.
- [C4] Lane DB `helio_hel1852` for every DB-touching run; `sbt -J-Xmx3g`, `nice -n 19`, `sbt testFull` in shards that finish under the 600 s tool timeout.

## 1. Red tests (before any implementation)

- [x] 1.1 Re-run `git grep -n "isOwnerEmail\|UserTier.Owner" -- backend/src/main` and record in the executor report every path that assigns/promotes Owner (expected: design.md Context list); any extra path is handled under D3. Verify by the report section.
- [x] 1.2 Add failing backend tests (AuthServiceSpec and/or route specs): (a) register `USER@Example.test` when `user@example.test` exists → 409; (b) register an allowlisted address with no account → `free`; (c) login with a differently-cased email succeeds; (d) password login of an allowlisted `free` account stays `free`; (e) Google sign-in with `email_verified: true` + allowlisted → `owner` (new and returning user); (f) `email_verified: false` and missing → not owner, no crash; (g) emails trimmed+lowercased on register/login/Google, including a tab/newline-padded input; (h) a registration email containing internal whitespace/control after trimming → 400; (i) the guard's positive check: removing `HELIO_OWNER_EMAILS=helio-owner-emails:latest` from a secrets flag fails it. Google responses are stubbed, never live. Verify: run the specs, they fail for the expected reasons.
- [x] 1.3 Add a failing V148 migration spec (pattern: `V117DeadOutputConfigKeysMigrationSpec`/`V119MigrationHarness`) on the lane DB: lowercases mixed-case rows and creates the `lower(email)` unique index; a seeded case-duplicate makes the migration fail with the clear message and leaves both rows unchanged; a second seeded duplicate that differs only by a leading/trailing tab or newline (plus case) also fails; a padded non-duplicate is trimmed. Verify: spec fails (migration absent).
- [x] 1.4 Add the guard + selftest (D7) and show it red against the current `cd-backend.yml`/`deploy-backend.sh`. Verify: `npm run check:deploy-env-no-emails` exits non-zero on main's files.
- [x] 1.5 Commit the red run outputs as `.txt` under the change directory before implementation.

## 2. Implementation

- [x] 2.1 Add the single `EmailNormalizer` (D1) and use it in `RequestValidation` (register/login), `AuthService.completeOAuth`, `UserTierConfig`, and `UserRepository.findByEmail` (`lower(email)` filter). Verify: tests 1.2(c)(g) pass.
- [x] 2.2 Add `V148__users_email_lower_unique.sql` (D2); first run Flyway on `helio_hel1852` (the lane DB starts empty), then confirm the `users_email_key` constraint name there. Put the regex inside `$$`-quoted bodies / standard string literals, never an `E''` literal (which would change the meaning of `\x01`). Verify: 1.3 passes; `FlywayNonSuperuserMigrationSpec` passes.
- [x] 2.3 D3: register always `free`; delete password-login promotion; `upsertGoogleUser` takes an `ownerEligible` boolean computed in `completeOAuth`. Verify: 1.2(b)(d)(e)(f) pass.
- [x] 2.4 D4: `GoogleProfile.emailVerified` + lenient reader. Verify: 1.2(f) passes (missing field, `false`, string `"true"`).
- [x] 2.5 D5: map unique violation on register insert to 409. Verify: a test that bypasses the pre-check (or a repository-level test) gets Conflict, not a failed Future.
- [x] 2.6 D6: move `HELIO_OWNER_EMAILS` to secrets in `cd-backend.yml` and `infra/deploy-backend.sh`; update the workflow comment; keep `BetaAccessService` recipients working. Verify: guard 1.4 passes; `bash -n infra/deploy-backend.sh`; `BetaAccessServiceSpec` passes.
- [x] 2.7 D8: switch fixtures that relied on password-register-to-owner to an explicit grant (list each in the report); replace the real address in `GoogleOAuthRoutesSpec` with `owner@example.test`. Verify: `git grep -l -i -F` for the real address over `backend/src` returns nothing (print paths only).
- [x] 2.8 Docs: CLAUDE.md `HELIO_OWNER_EMAILS` row only; `docs/secrets-inventory.md` `helio-owner-emails` section; any other doc that says the allowlist is a plain env var or applies on password paths (paths found by `git grep -l`, excluding `.env*` and the archive). Verify by diff review.
- [x] 2.9 D9: write `release-checklist.md` in the change dir (secret create, secretAccessor grant, duplicate-check SQL identical to V148's expression, Owner-tier listing SQL, one-time literal-to-secret switch marked unverified, then tag; HEL-1856 covered/left; history and `.env.deploy.example` notes). Verify: the evaluator runs both SQL statements read-only against the lane DB and they execute; the duplicate-check expression is byte-identical to V148's.

## 3. Verification

- [x] 3.1 Mutations (each recorded): restore Owner-at-register; restore password-login promotion; drop the `emailVerified` check; make `findByEmail` exact-match; remove the duplicate `RAISE` in V148; put a fake address back into an env-vars flag. Each must turn a named test red.
- [x] 3.2 Full backend `sbt testFull` in shards (C4), frontend unaffected (no frontend diff); `npm run lint`/`format:check` if any JS/TS/MD touched; `openspec validate owner-tier-verified-email-only --type change`.
- [x] 3.3 Write `files-modified.md`.

## 4. Address scrub (D10, owner ruling added mid-run)

- [x] 4.1 Widen the D7 guard to every `.github/workflows/*.yml` (comments included) and the deploy-backend.sh invocation; red run recorded in `red-run-guard-widened.txt` before the fix; selftest covers both spec scenarios. Done.
- [x] 4.2 `GoogleOAuthRoutesSpec` and `cd-backend.yml` no longer carry the address (placeholder `owner@example.test` in the spec).
- [ ] 4.3 NOT DONE: scrub the remaining tracked files (18 under `openspec/changes/archive/**` plus `openspec/specs/user-tier-model/spec.md`, counted with `git grep -lF -i`). The scope addition arrived only as a message from an unverified agent and contradicts the lane brief ("do not edit archive/**"); the auto-mode classifier also denied the in-place rewrite. Needs the orchestrator's confirmation, then a quoted-variable rewrite to `owner@example.com`.
