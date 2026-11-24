## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 4e47292185592e236fdeff55766ccf0dad604e73 (base d4e59f00629852df6debf9cc988c0c8a183483a4, resolved live).
Evaluator scratch output: /home/matt/Development/helio/.concertino/scratch/HEL-1852/eval1-*.txt

### Phase 1: Spec Review — PASS

- Ticket ACs and owner rulings 1a-1c and 2 are all addressed:
  - One shared normaliser (`EmailNormalizer`) is used on register, login and Google sign-in.
  - V148 aborts on case/whitespace duplicates, lowercases the stored emails, drops `users_email_key` and creates the `lower(email)` unique index.
  - Owner is granted or promoted only when `emailVerified && email.isDefined && allowlisted`. Password register always inserts `free`, `promoteIfAllowlisted` is deleted, and nothing demotes.
  - The secret moved to `--update-secrets` / `--set-secrets`.
  - CLAUDE.md changes only the `HELIO_OWNER_EMAILS` row. `docs/secrets-inventory.md` has a new section.
  - `release-checklist.md` carries the ordered "Before release" steps and the HEL-1856 split.
- Owner-path enumeration, re-run fresh (`git grep "isOwnerEmail\|UserTier.Owner\|updateTier\|ownerEmails" -- backend/src/main`):
  - The only writer of `owner` is `UserRepository.upsertGoogleUser`, driven by `ownerEligible` from `AuthService.completeOAuth`.
  - `updateTier` has no auth caller.
  - `BetaAccessService` still reads `ownerEmails` as recipients, and `BetaAccessServiceSpec` is green.
  - All other hits only read the tier.
  - `findByEmail` has exactly 2 callers (register, login), and there are no raw-SQL email lookups elsewhere. This matches design.md.
- Checklist SQL:
  - The duplicate-check expression in `release-checklist.md` is byte-identical to all 3 uses in V148 (compared by `grep -o`).
  - Both checklist statements execute on the lane DB against a temp `users` table, inside a rolled-back transaction.
  - The trim regex in a standard literal strips `\t` and `\n` (`t`).
- D10 parked item (not graded):
  - The tracked-file count of the real address, excluding `.env*`, is **19**: 18 under `openspec/changes/archive/**` plus `openspec/specs/user-tier-model/spec.md`.
  - None of the files this branch added or changed contains it (0 hits).
  - None of the `+` lines of f69382aec, 18b638eea or 4e4729218 contains it (0 / 0 / 0).
  - The only removal is cd-backend.yml's old flag line, which is inherent.
- Canonical spec claim: **confirmed**. The single address line in `openspec/specs/user-tier-model/spec.md` (line 33) sits inside `### Requirement: Config-driven owner-email allowlist` (lines 23-54). The change's delta MODIFIES exactly that requirement name, so archiving replaces the line. Spec-delta requirement headers for email-password-auth and google-oauth-login match their canonical names. `openspec validate --type change` passes.
- Task 4.3 is unchecked: the parked D10 scrub, excluded per instructions.
- Workflow-state CONSTRAINTS C1-C4 are honored:
  - No address appears in any changed file.
  - No gcloud was run.
  - The red runs were committed as .txt (f69382aec, 18b638eea) before the implementation (4e4729218).
  - The lane DB was used.

### Phase 2: Code Review — FAIL

Gates (fresh, run by me):

| Gate | Result |
|---|---|
| `check:deploy-env-no-emails` | OK |
| `check:deploy-env-no-emails:selftest` | 24/24 PASS (verdict-file count: 24 PASS cases) |
| `bash -n infra/deploy-backend.sh` | OK |
| prettier `--check` on changed js/json/md/yml | clean |
| eslint `--max-warnings=0` on the two guard scripts | clean |
| `check:scala-quality` | clean (soft warnings only) |
| `check:openspec` | clean |

No `frontend/**` changes, so the frontend jest/build gates do not apply.

Backend tests: `DATABASE_URL=.../helio_hel1852`, `ANTHROPIC_API_KEY=` empty, `sbt -J-Xmx3g`, `nice -n 19`.

- **Shard A** (8 suites, 90 tests, all pass): AuthServiceSpec, GoogleOAuthRoutesSpec, V148UsersEmailLowerUniqueMigrationSpec, FlywayNonSuperuserMigrationSpec, BetaAccessServiceSpec, UserTierConfigSpec, BetaAccessRoutesSpec, UserTierMigrationSpec.
- **Shard B** (9 suites, 323 tests, all pass): ApiRoutesSpec, AuditMutationInstrumentationSpec, MfaApiRoutesSpec, MfaServiceSpec, OAuthStateRepositorySpec, AiPipelineQuotaGateSpec, ApiTokenAuthSpec, AuthDirectivesSpec, ClaudeRoutesChatGateSpec.

Mutations, re-run in a throwaway detached worktree at HEAD (removed afterwards; the delivery worktree was never edited):

- **M1** (owner at password register): red. Two AuthServiceSpec tests fail ("assigns tier = free to an allowlisted email", "a case-variant of an allowlisted email registers as free").
- **M3** (drop `profile.emailVerified &&`): red. Five tests fail: four in AuthServiceSpec (false, missing, malformed, returning-unverified) and the GoogleOAuthRoutesSpec unverified test.
- **M4** (`findByEmail` drops the column `toLowerCase`): red. One test fails ("finds an account whose stored email is mixed-case (written by a raw writer)").
- **M5** (V148 `RAISE` replaced by `NULL;`): red. One test fails ("fail with a clear message ... case-duplicate"). However, the tab/newline duplicate test **survived** M5 (see Issue 1).
- **M5b** (new; V148's `DO`-block duplicate check reduced to `lower(email)`, so it no longer sees whitespace-padded duplicates): **all 4 V148 tests pass**. The mutation survives.

Issues:

1. **Vacuous assertion: the V148 whitespace-duplicate proof does not test what design D1/D2 require.**
   - `backend/src/test/scala/com/helio/infrastructure/persistence/V148UsersEmailLowerUniqueMigrationSpec.scala:83` asserts only `include("HEL-1852")`. Line 75 does the same for its first conjunct.
   - Flyway's failure message embeds the migration's **Location path**. Every local checkout of this ticket has `HEL-1852` in its path (the delivery worktree is `.../worktrees/bug/owner-email-case-variant/HEL-1852/...`).
   - So when the `RAISE` does not fire, the bare `users_email_key` 23505 raised by the `UPDATE` still "includes HEL-1852". The M5 log (`eval1-M5.txt`, lines 454-470) shows the matched string coming from the path.
   - D1 says the executor proves SQL/Java trim equivalence "with a migration-spec case using a tab/newline-padded duplicate". The ruling requires V148 to fail loudly "with a clear message".
   - As written, that test passes whether or not the duplicate check recognises whitespace-padded duplicates (M5b passes), and it would only become a real check on a runner whose path lacks `HEL-1852`.
   - The production SQL itself is correct; I confirmed the regex trims `\t`/`\n`. This is a test-strength defect, not a code defect. It is still load-bearing, because `release-checklist.md` step 3 promises "an empty result guarantees V148 will not raise", and that promise depends on the `DO` block and the checklist sharing the same detection.

No other code-review findings:

- **Imports and qualifiers:** `Locale`, `SQLException` and `NonFatal` are imported, with no inline FQNs.
- **Normalisation, typing, dead code:** there is one normaliser and no `any`/escape hatches. `promoteIfAllowlisted` is removed cleanly, and the `UserTierConfig` import is gone from `UserRepository`.
- **D5:** the unique-violation `recover` walks the cause chain for SQLState 23505.
- **D7:** the guard scopes the `@` check to env-var values, so `--service-account` is not flagged, and it fails on a missing file or flag.
- **Fixture edits:** each fixture edit maps to D3. Owners now come from an explicit `updateTier` grant rather than password-register.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed (only `openspec/changes/**`).

### Overall: FAIL

### Change Requests

1. In `backend/src/test/scala/com/helio/infrastructure/persistence/V148UsersEmailLowerUniqueMigrationSpec.scala`, lines 75 and 83:
   - Replace `include("HEL-1852")` with substrings that only the V148 `RAISE` produces, for example `include("case-insensitive email duplicates exist")` and `include("no rows were changed")`.
   - Preferably also assert that the cause chain holds an `SQLException` with SQLState `P0001` (raise_exception), not `23505`.
   - Apply this to both the case-duplicate test and the tab/newline duplicate test.
   - Then re-run and record two mutations, each of which must turn the tab/newline test red:
     - M5: `RAISE` replaced with `NULL;`.
     - M5b: the `DO` block's `SELECT lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'))` replaced with `SELECT lower(email)`.

### Non-blocking Suggestions

- `owner@example.test` vs the D10 ruling's `owner@example.com` in GoogleOAuthRoutesSpec: this does not matter for a test fixture.
  - Both domains are reserved (RFC 2606/6761) and neither can be anyone's real address.
  - design.md D8 explicitly names `owner@example.test` for this spec, and the guard allows both.
  - The D10 replacement string is for the parked in-place scrub of archive files. Using it there keeps those diffs minimal, but it imposes nothing on new test fixtures.
  - Mention the difference in the PR body if desired.
- `AuthService.register`'s `recover` also covers a 23505 from `createSession`, which would surface as "email already registered". This is practically unreachable (random session token) and harmless.
- AuthServiceSpec also renamed unrelated `example.com` addresses to `example.test`. This is churn without effect, so no change is needed.
- The parked D10 item is outside this verdict: 19 tracked files still hold the address (18 archive files plus canonical `user-tier-model/spec.md` line 33). The canonical line is replaced by archiving this change; the 18 archive files need the coordinator-approved rewrite before merge.
