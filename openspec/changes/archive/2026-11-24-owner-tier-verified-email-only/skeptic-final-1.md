## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 679ca61dd6c3641a2eae7f9d2d29c3b2aa663365. The review base was resolved live with `resolve-review-base.sh` (exit 0) as d4e59f00629852df6debf9cc988c0c8a183483a4. origin/main has moved on to 1370a8d48, and `git merge-tree` against it is clean. Neither V148 nor V149 exists on origin/main.

I followed the lane constraints. I read no `.env*` file and never printed the owner address: it went into a shell variable, I listed only paths and counts, and then I unset it. I ran no gcloud. The sbt run used DATABASE_URL=helio_hel1852, exported in the same command, with ANTHROPIC_API_KEY empty. I started no servers.

### What I verified (with evidence)

**1. No path from a password signup or password login, or from an unverified Google profile, yields Owner.**

I re-enumerated every Owner write with `git grep "isOwnerEmail|UserTier.Owner|updateTier|INSERT INTO users|UPDATE users"` over `backend/src/main`. Only these places can write `owner`:

- `UserRepository.upsertGoogleUser`, at lines 84-85 and 94. It is driven only by the `ownerEligible` Boolean.
- `updateTier`. No auth caller remains, because `promoteIfAllowlisted` is deleted.
- `InviteCodeRepository`. It writes `beta` only.
- `UserPreferenceRepository`. It writes preferences only.

`ownerEligible` is computed once, at `AuthService.scala:219`, as `profile.emailVerified && profile.email.isDefined && tierConfig.isOwnerEmail(email)`. Register hardcodes `UserTier.Free` at `AuthService.scala:124`. Login calls `finishLogin(user)` with no tier change.

`upsertGoogleUser` has one caller, `AuthService.completeOAuth`. `OAuthRoutes.scala:92` parses userinfo through `convertTo[GoogleProfile]`, and that is the lenient reader at `AuthProtocol.scala:76-90`. The specs feed raw JSON through that same reader, so the `email_verified` true / "true" / false / missing / malformed cases are exercised at the parse layer.

**2. V148 on a real Postgres, including as the non-superuser Flyway role.**

I ran `V148UsersEmailLowerUniqueMigrationSpec` and `FlywayNonSuperuserMigrationSpec` myself: 4 and 1 tests, all green. The log is `/home/matt/Development/helio/.concertino/scratch/HEL-1852/skeptic-final-sbt1.txt`.

- The non-superuser spec connects as `user=helio_migration_test`, a NOSUPERUSER, NOBYPASSRLS role. Its log shows `Migrating schema "public" to version "148 - users email lower unique"` and then `now at version v148`, with the realistic users fixture loaded.
- `users` has no RLS policy (no migration enables it). So the `DO` count and the `UPDATE` see every row under the `helio` role.
- V88 already ran `ALTER TABLE users` in prod as that role. That is evidence the role can `DROP CONSTRAINT` on the table.
- V6, V8 and V9 never rename the constraint, so `users_email_key` is the default name, and the DROP has no `IF EXISTS`.
- The evaluator's mutation runs (RAISE replaced with `NULL;`, and a lower-only check) turn the case test and the tab/newline test red. The spec asserts SQLState P0001 and the RAISE text, so Flyway echoing the worktree path cannot satisfy it.

**3. The secret ruling: deploy configs and the CI guard.**

- The address appears in HEAD in only 19 files: `openspec/specs/user-tier-model/spec.md` plus 18 `openspec/changes/archive/**` files. That is the D10 / HEL-1878 residue the owner accepted; I did not grade it.
- `cd-backend.yml:105`: `HELIO_OWNER_EMAILS` is gone from `--update-env-vars`, and `--update-secrets` maps `HELIO_OWNER_EMAILS=helio-owner-emails:latest`.
- `infra/deploy-backend.sh:123-124`: likewise for `--set-env-vars` and `--set-secrets`. No other `HELIO_OWNER_EMAILS` reference remains in that script.
- `ci.yml` runs `check:deploy-env-no-emails` and its selftest. Both exit 0 here, with 24/24 selftest cases.
- I ran my own mutations against a scratch copy (`node scripts/check-deploy-env-no-emails.mjs <copy>`), all with fake values. Each one fails the guard:
  - a misspelt secret name in the workflow;
  - a literal mixed-case fake address in `--update-env-vars`;
  - dropping the mapping from `deploy-backend.sh`.
- `CLAUDE.md:59` and `docs/secrets-inventory.md` describe the secret correctly. `BetaAccessService` still reads `tierConfig.ownerEmails`, and its specs are green.

**4. The canonical spec line is replaced at archive.**

The address is at line 33 of `openspec/specs/user-tier-model/spec.md`. That line sits inside `### Requirement: Config-driven owner-email allowlist`, scenario "Allowlisted email registers and is assigned owner".

The change's delta MODIFIES that same requirement, with an identical name. The delta's text uses `owner@example.test` only. So archiving replaces the whole block, line 33 included. Confirmed.

The other two MODIFIED deltas keep every scenario of the original requirement and only add new ones:

- email-password-auth: User registration / User login;
- google-oauth-login: successful callback.

`openspec validate owner-tier-verified-email-only --strict` reports the change is valid.

**5. Tests and acceptance criteria.**

My run: 107 tests across the 9 most relevant specs, 0 failed. The specs are `AuthServiceSpec`, `GoogleOAuthRoutesSpec`, `UserTierConfigSpec`, `BetaAccess{Service,Routes}Spec`, `AiPipelineQuotaGateSpec`, `ClaudeRoutesChatGateSpec`, V148 and FlywayNonSuperuser. Every test spec that builds a non-empty `UserTierConfig` is in that set.

| Ticket AC | Status and evidence |
|---|---|
| AC1: trim and lowercase | Met. `EmailNormalizer` is applied in `RequestValidation` (register and login), `completeOAuth`, `isOwnerEmail` / `fromEnv`, and `findByEmail` (`lower(email)`). |
| AC2: migration | Met. V148, as verified in item 2. |
| AC3: Owner only from a verified email | Met, as verified in item 1. |
| AC4: secret | Met, as verified in item 3. The `.env` example is the driver's, already on main in 1370a8d48. |
| AC5: Owner listing | Met. `release-checklist.md` step 4. |
| AC6: tests | Met. The named case-variant register tests, the 409 test, and the Google verified / unverified / missing / malformed / synthetic-address tests are all green. |

Other checks:

- Prettier passes on the new scripts and docs.
- No `--no-verify` or bypass appears in the commit messages.
- CD fires only on `v*` tags, so merging does not deploy.

**6. Release checklist gating: the one defect.**

The order is right: create the secret, grant secretAccessor, run the duplicate check, run the Owner listing, do the one-time literal-to-secret switch, then tag. The duplicate-check SQL uses exactly V148's normal-form expression.

But step 3 only says that "an empty result guarantees V148 will not raise". The Notes add that "V148 aborts the migration step loudly if step 3 would have returned rows". Nowhere does the checklist say: if this returns rows, STOP, do not tag. Nor does it say what to do then.

Ruling 1b requires that "the PR states the migration's release is gated on that check". "Do these in order" reads as a sequence to execute, not a gate. The orchestrator asked specifically for unambiguous gating. As written, an owner could run step 3, see rows, and carry on through steps 5-6.

The old code in prod still accepts case-variant registrations until V148 ships. So a duplicate can also appear between the check and the tag. The check therefore has to be re-run immediately before tagging. The checklist does not say so.

### Verdict: REFUTE

### Change Requests

1. **`openspec/changes/owner-tier-verified-email-only/release-checklist.md`, step 3**, which is the source of the PR body's "Before release". Make the duplicate check an explicit gate:
   - Add a hard stop condition: **"If this returns ANY row, STOP: do not tag. V148 will refuse to migrate and the new revision will not start."**
   - Add one line on resolution: each group is resolved by hand (decide which account keeps the address; rename or delete the others), then re-run the query until it returns no rows.
   - Require the query to be re-run immediately before step 6. The still-running old code accepts case-variant signups until V148 is live, so a clean result from earlier can go stale.
   - Make step 6 read "Then tag the release, only after step 3 returned no rows on its final run", or equivalent wording.

   This is a docs-only edit. No code or test change is required.

### Non-blocking notes

- I created a scratch guard-probe copy at `/home/matt/Development/helio/.concertino/scratch/HEL-1852/skeptic-guard-probe2/`. It holds copies of the workflow files and `deploy-backend.sh` with fake addresses, and no secrets. It is safe to delete; the permission system blocked my removal of it.
- The evaluator's full-suite evidence is the auth shards (413 tests), not a whole `testFull`. The `GoogleProfile` and `upsertGoogleUser` signature changes compile across the tree, because the sbt test compile succeeded. CI will be the full measurement.
- A Google first sign-in for an address that already has a password row still ends in the generic 500. This is documented as the HEL-1856 linking rule, and the PR body must state it as the checklist Notes do.
- UI: there are no frontend changes, so Step 4 does not apply.
