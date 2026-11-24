## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: 9a5517ed0eb6e004abb794ccd2639752ec008bde. I resolved the review base live with `resolve-review-base.sh` (exit 0): d4e59f00629852df6debf9cc988c0c8a183483a4.

`origin/main` has moved on to 1737116227 (HEL-1837). `git merge-tree --write-tree origin/main HEAD` is clean. The newest migration on origin/main is still V147, so V148 is free.

I followed the lane constraints:
- I read no `.env*` file.
- The owner address went into a shell variable taken from `git show d4e59f006:.github/workflows/cd-backend.yml`. I printed only lengths, counts and paths, then unset it.
- I ran no gcloud.
- sbt and the servers ran with `DATABASE_URL=helio_hel1852`, `DB_USER` and an empty `ANTHROPIC_API_KEY`, all exported in the same command.
- I stopped the servers with `stop-servers.sh`.
- I deleted my one probe user by exact id.
- I removed my scratch guard copy.

### What I verified (with evidence)

**1. Round 1's change request is genuinely met.**

`release-checklist.md` step 3 now carries:
- "**STOP: if this query returns ANY row, do not tag.**", with the reason (V148 refuses to migrate and the revision does not start);
- the resolution (resolve each group by hand, then re-run until it returns no rows);
- "**Re-run it immediately before tagging (step 6)**", with the stale-result reason.

Step 6 reads "**Tag only after step 3 returned no rows on its final run** (the re-run immediately before tagging)."

The duplicate-check SQL is byte-identical to V148's:
- `grep -oE "lower\(regexp_replace\([^)]*\)\)"` finds the single string `lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'))` in both files: 3 times in V148, once in the checklist.
- The `GROUP BY 1 HAVING count(*) > 1` shape matches V148's `DO` block.
- `git show 9a5517ed0` touches only `release-checklist.md`, and none of its +/- lines contains the regexp.

The order of "Before release" matches ruling 2: secret, then secretAccessor, then duplicate check and Owner listing, then the literal-to-secret switch, then tag.

**2. No path from password signup, password login or an unverified Google profile reaches Owner.**

I enumerated tier writes with `git grep "isOwnerEmail|ownerEmails|UserTier.Owner|updateTier|INSERT INTO users|UPDATE users|users +="` over `backend/src/main`, plus callers of `UserTier.fromString`. The only places that can write `owner` are:
- `UserRepository.upsertGoogleUser`, lines 84-85 and 94, gated solely on the `ownerEligible` Boolean;
- `updateTier`, which has no caller left in `main` (`promoteIfAllowlisted` is deleted).

Nothing else writes `owner`:
- `InviteCodeRepository` writes `'beta'` only, and only `WHERE tier = 'free'`.
- `UserPreferenceRepository` writes `preferences` only.
- No route parses a tier from input.

`ownerEligible` is computed in exactly one place, `AuthService.scala:219`: `profile.emailVerified && profile.email.isDefined && tierConfig.isOwnerEmail(email)`. The synthetic `google:<sub>@helio.invalid` fallback is excluded by `email.isDefined`.

`GoogleProfile` is parsed only in `OAuthRoutes.fetchGoogleProfileImpl` (`convertTo[GoogleProfile]`). The reader maps only `JsBoolean(true)` and `JsString("true")` to `true`, and defaults to `false`.

On the password side:
- Register hardcodes `UserTier.Free` (line 124).
- Login calls `finishLogin(user)` with no tier write.
- A concurrent register that hits the unique index gets `23505`, which maps to a 409.

Live probe against the lane backend (`start-servers.sh`, then `assert-phase.sh servers` printed `PASS servers`):
- `POST /api/auth/register` `owner@example.test` returned `201`, `tier: "free"`.
- `"  OWNER@Example.TEST "` returned `409 email already registered`.
- Login as `OWNER@EXAMPLE.TEST` returned `200`, then `/api/admin/usage` returned `403 TIER_FORBIDDEN`.
- The DB row was `owner@example.test | free | has_password`, deleted afterwards by id.

Caveat: I exported `HELIO_OWNER_EMAILS=owner@example.test` for that start, but I did not inspect the process environment (C1), so I cannot prove the allowlist was active. The allowlisted cases are proven by the service and route specs below.

**3. V148 on a real Postgres, including the non-superuser role.**

I ran this myself, log in `/home/matt/Development/helio/.concertino/scratch/HEL-1852/skeptic-final2-sbt.txt`:

`sbt testOnly V148UsersEmailLowerUniqueMigrationSpec FlywayNonSuperuserMigrationSpec AuthServiceSpec GoogleOAuthRoutesSpec UserTierConfigSpec BetaAccessServiceSpec`

Result: exit 0, `Tests: succeeded 74, failed 0`.

- `FlywayNonSuperuserMigrationSpec` connects as `helio_migration_test`, a role that is LOGIN NOSUPERUSER NOBYPASSRLS and owns the public schema, so it owns every table. That matches prod. The log shows `Migrating schema "public" to version "148 - users email lower unique"` and then `now at version v148`, over the realistic dump fixture.
- The V148 spec covers four cases:
  - lower-casing, trimming and the index, with a `23505` on a case-variant insert;
  - a case duplicate raises P0001 with the RAISE text, and the rows are unchanged;
  - a tab/newline-padded duplicate raises with "1 group(s)";
  - the row count is unchanged on success.
- The assertions require SQLState P0001 in the cause chain, so a path echoing "HEL-1852" cannot satisfy them.
- The DROP has no `IF EXISTS`, and no code references `users_email_key` or `ON CONFLICT (email)`.

**4. The secret ruling and the CI guard.**

`HELIO_OWNER_EMAILS` is no longer in any env-vars flag:
- `cd-backend.yml:105`: the `--update-env-vars` value has 0 hits; `--update-secrets` maps `HELIO_OWNER_EMAILS=helio-owner-emails:latest`.
- `infra/deploy-backend.sh:123`: the `--set-env-vars` line has 0 hits; line 124's `--set-secrets` maps the secret.

CI:
- `ci.yml:60-61` runs `check:deploy-env-no-emails` and its selftest.
- Both exit 0 here, and the selftest prints "selftest OK".

My own mutations ran on a scratch copy of the workflow dir and the deploy script, with fake values only. The baseline passes (exit 0) and every mutation fails (exit 1):
- a comment line holding a fake gmail address in `ci.yml`;
- dropping the secret mapping from `cd-backend.yml`;
- a `HELIO_OWNER_EMAILS=X` entry with no `@` added to `--update-env-vars`;
- dropping the mapping from `deploy-backend.sh`.

Tracked files that still hold the real address, excluding `.env*` paths (`git grep -l -i -F`, paths only):
- 18 `openspec/changes/archive/**` files. Owner decision, HEL-1878; not graded.
- `openspec/specs/user-tier-model/spec.md` line 33, which lies inside `### Requirement: Config-driven owner-email allowlist`. The change's delta MODIFIES that exact requirement name using only `owner@example.test`, so archiving replaces the line.

`openspec validate owner-tier-verified-email-only --strict` reports the change is valid.

The docs are correct:
- `CLAUDE.md`: only the `HELIO_OWNER_EMAILS` row changed.
- `docs/secrets-inventory.md`: the new `helio-owner-emails` section covers what the secret is, where it lives, the accessor SA and rotation.
- `BetaAccessService` still reads `tierConfig.ownerEmails`, and its spec is green.

Prettier passes on the guard, its selftest, the docs and the checklist. No commit message contains a bypass.

**5. Acceptance criteria.**

| Ticket AC | Status and evidence |
|---|---|
| AC1: trim and lowercase on register, login and Google | Met. A single `EmailNormalizer` (`domain/util`) is applied in `RequestValidation` (register and login), `completeOAuth`, `isOwnerEmail`/`fromEnv` and `findByEmail` (`lower(email)`). Tests: AuthServiceSpec 159, 266, 273, 333. |
| AC2: `lower(email)` unique index, gated on a duplicate check | Met. V148 (item 3), plus checklist step 3 as a STOP gate (item 1). |
| AC3: Owner only from a verified email or a manual grant | Met (item 2). Tests: AuthServiceSpec 134, 141, 256, 318-388; GoogleOAuthRoutesSpec 333, 359, 403, 452. |
| AC4: secret moved out of the workflow and the example | Met (item 4). The example env is the driver's, per the ruling. |
| AC5: one-time Owner listing | Met. Checklist step 4. |
| AC6: tests for case-variant register and the Google paths | Met. All green in my run. |

Owner rulings:
- 1a-1c: met.
- HEL-1856: the checklist Notes state what it covers and what it leaves.
- 2: met, and no gcloud was invoked by the lane.

UI: there are no frontend changes, so the design step does not apply.

### Verdict: CONFIRM

### Non-blocking notes

- **Step 4 (Owner listing) has no re-run after the release goes live.** The old code keeps granting Owner on case-variant password signups until the new revision serves.
  - A variant of an address that already has a row creates a collision. The final step-3 run catches it, and so does V148, which would then abort the deploy.
  - An allowlisted address that has no row yet would escape both checks. Owner is never demoted, so such an account would keep Owner.
  - Suggested wording for the PR body: "re-run step 4 once the new revision is serving".
  - Also add one line on what to do if the CD migration step fails after tagging: the old revision keeps serving, so resolve the duplicates, then re-tag.
- The lane's own targeted run is 74 tests in 6 specs. Round 1 ran 107 tests in 9 specs, and the evaluator ran the auth shards. A whole `testFull` is still CI's job.
- HEL-1878 still owes the scrub of the 18 archive files. The PR body must say that tracked files and git history still hold the address.

### Gate-defect check (CON-160)

None of the evidence I relied on depends on mtime ordering. I persisted no screenshots.
