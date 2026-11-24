## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD d4e59f00629852df6debf9cc988c0c8a183483a4 (change dir untracked; artifacts read from disk).
Constraints obeyed: no `.env*` file read; every command touching the address was masked (`<ADDR>`); no gcloud;
only read-only SELECTs of literals on `helio_hel1852`.

### What I verified (with evidence)

**Round-1 CR1 (D1/D2 trim definitions): fixed.**
- D1 now fixes trim as Java `String.trim` (U+0000..U+0020), and D2 uses
  `lower(regexp_replace(email, '^[\x01-\x20]+|[\x01-\x20]+$', '', 'g'))` in both the `DO` duplicate check and
  the `UPDATE`. Task 1.3 adds a tab/newline-padded duplicate case.
- I ran the expression read-only in Postgres 18.6 on `helio_hel1852` (`standard_conforming_strings=on`, collation
  en_US.UTF-8), with literals only:
  - `E'\tA@B.co\t'` → `a@b.co` (length 6): t
  - `E' \r\n A@B.co \n\r\x0b\x0c\x1f'` → `a@b.co`: t
  - `E'\x01a@b.co\x01'` → stripped: t
  - internal space/tab kept (`E' a @b.co\tx '` → `E'a @b.co\tx'`): t
  - `!` (0x21), DEL (0x7f) and NBSP (U+00A0) not stripped: t, t, t. This matches Java `trim`, which also keeps
    0x7f and U+00A0.
  - all-whitespace → length 0, and `^`/`$` anchor at the string ends only, not at embedded newlines: t
  - control: `btrim(E'\ta@b.co') = 'a@b.co'` → f. This confirms the round-1 defect was real and the new form
    fixes it.
  - Postgres's ARE `\xhhh` takes any number of hex digits, but here each escape is followed by `-` or `]`, so it
    parses as intended. Proven by the results above.
- ASCII-only lowercasing claim: `lower('ÀÉ İ K')` → `àé i k` in Postgres, so Postgres maps U+0130 to `i`. Java
  `toLowerCase(Locale.ROOT)` maps it to `i` plus a combining dot. The divergence is real, and D1 correctly limits
  equivalence to ASCII. It is harmless for this ticket:
  - uniqueness is decided only by the index on `lower(stored)`;
  - `findByEmail` compares Postgres `lower(stored)` with the Java-normalised input. A registered value is stored
    already Java-normalised, so the same user's input round-trips.
  - `isOwnerEmail` normalises both sides in Java, and after D3 Owner also requires `email_verified`. A
    lowercasing mismatch therefore cannot grant Owner.

**Round-1 CR2 (release-checklist task): fixed.**
- D9 and task 2.9 produce `release-checklist.md` in the ruling's order:
  1. create the secret;
  2. grant secretAccessor to `helio-backend-sa`;
  3. run the duplicate-check SQL, byte-identical to V148's expression, so a clean check guarantees V148 will not
     raise;
  4. run the Owner-tier listing with `has_google`/`has_password`, which makes the attack's signature visible;
  5. do the literal-to-secret switch, marked unverified;
  6. tag.
- The checklist also records the HEL-1856 covered/left split and the history and `.env.deploy.example` notes.
  Task 2.9's acceptance signal (evaluator runs both SQL read-only on the lane DB; byte-identical expression) is
  checkable.

**Folded-in round-1 notes: adequate.**
- Guard (D7) is scoped to env-var flag VALUES. I confirmed `deploy-backend.sh:122` `--service-account=...@...`
  would otherwise false-positive. In `deploy-backend.sh:123`, the only `@`-bearing env-vars entry is the
  interpolated `${HELIO_EMAIL_FROM}` (no literal `@`). The `^|^` delimiter is present there, and the guard must
  parse it. `cd-backend.yml:101` env-vars has exactly one `@` token (the owner literal), so the guard goes red on
  main and green after D6.
- The positive mapping check (`HELIO_OWNER_EMAILS=helio-owner-emails:latest` in both secrets flags) plus
  fail-on-missing makes the production-deployment-docs scenario consistent with D7. Task 1.2(i) proves it red.
- D6 atomic form: `--remove-env-vars` plus `--update-secrets` in one `services update`, with the two-step form as
  fallback and the 503 window disclosed. The service/region/project (`helio-backend`/`us-west1`/`helio-493120`)
  match `cd-backend.yml:52-53` and `deploy-backend.sh:116-132`.
- D5 adds a test that a Google first sign-in colliding by case with a password row is rendered by the callback's
  existing failure handling.

**Re-derived independently (not trusting round 1).**
- Owner-assignment sites on HEAD:
  - `AuthService.scala:120` (register) and `:163`/`:228-230` (`promoteIfAllowlisted` on login);
  - `UserRepository.scala:86` and `:96` (Google returning and new user).
  - D3 removes or gates every one of them.
- `findByEmail` (`UserRepository.scala:49`, exact match) is the only email-filtered lookup in `backend/src/main`.
- `completeOAuth` (`AuthService.scala:209-212`) is the single place to compute `ownerEligible`. The fallback
  `google:<sub>@helio.invalid` is excluded by the `profile.email.isDefined` term.
- `BetaAccessService.scala:43` reads `tierConfig.ownerEmails`, and the env var name is unchanged.
- V147 is the latest migration, so V148 is free. V6 declares `email TEXT UNIQUE NOT NULL`, which gets the
  Postgres default name `users_email_key`. The lane DB is not migrated yet (`users` does not exist), so task
  2.2's "confirm on the lane DB first" needs a migrate step. This is an executor note, not a design gap.
- `check:cloud-run-cpu` is wired at `ci.yml:57-58` and `package.json:15-16`, as D7 assumes.
- The delta specs match the rulings:
  - 1a: one normaliser.
  - 1b: fail loudly; no merge or drop.
  - 1c: verified Google only; no demotion; the HEL-1856 split is stated.
  - 2: secret name, `--update-secrets`/`--set-secrets`, CLAUDE.md row only.
- Every ticket AC maps to a task.

### Verdict: CONFIRM

### Non-blocking notes
- tasks.md numbers 2.9 before 2.8. Cosmetic.
- Task 2.2: run Flyway on `helio_hel1852` before "confirm the constraint name". The lane DB currently has no
  `users` table.
- The `DO` block's `RAISE` message and the checklist SQL should carry the regex inside `$$`-quoted bodies or with
  `standard_conforming_strings` on, as tested here. An `E''` literal would change the meaning of `\x01`.
- A stored all-whitespace email would normalise to `''`. Two such rows would correctly trip the duplicate check.
  This is a theoretical edge case only.
