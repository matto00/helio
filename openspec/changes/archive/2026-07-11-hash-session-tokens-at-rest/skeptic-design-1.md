## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Migration numbering / safety.** `ls backend/src/main/resources/db/migration | sort -V | tail` shows
   `V44__panel_metric_literal_columns.sql` is the latest; `V45__hash_session_tokens.sql` does not collide.
   Grepped all migrations for `user_sessions` (`V7`, `V11`, `V17`, `V42`) — only `V17__add_owner_indexes.sql`
   touches the table post-V11, and only to add `idx_user_sessions_expires_at` (on `expires_at`, untouched by
   the rename). No RLS policy exists on `user_sessions` (V34–V36 RLS migrations never mention it), so the
   `DELETE FROM user_sessions; ALTER TABLE ... RENAME COLUMN/CONSTRAINT` plan has no other migration or
   policy to conflict with. The proposal's stated rationale for invalidating-not-rehashing (avoiding a
   pgcrypto-vs-`MessageDigest` byte-parity dependency, treating the rollout as a trust-boundary reset) is a
   real, load-bearing argument, not hand-waving, and matches the ticket's explicit "expire/invalidate...
   acceptable for a session store" scope line.

2. **Hash-at-repository-boundary decision, checked against real call sites.** Read
   `UserRepository.scala` (`createSession`/`findSession`/`deleteSession`, lines 103–118),
   `UserSessionRepository.scala` (`findValidSession`, line 22–31), and `AuthService.scala`. Confirmed
   `AuthService.logout` (line 90–94) calls `userRepo.findSession(token)` then
   `userRepo.deleteSession(token)`, both with the raw token straight from the route layer — exactly the
   two call sites tasks 1.6/1.7 target. `createSession` returns the original `session` argument unchanged
   (line 110: `.map(_ => session)`), which is why `AuthResponse.token` (built in `authResponseOf`,
   `AuthService.scala:121`) keeps carrying the raw value with no re-plumbing needed — the design's
   "no domain-model `tokenHash` field" call is workable, not a hidden gap. Grepped the whole tree
   (`grep -rn "user_sessions\|\.token\b"`) and found no other production call site; test fixtines
   (`ApiRoutesSpec`, `GoogleOAuthRoutesSpec`, `ComputedFieldsRoutesSpec`) only `TRUNCATE TABLE user_sessions`,
   never insert a raw row directly — confirms the proposal's claim about those fixtures.

3. **`TokenHashing` extraction.** Read `ApiTokenService.scala` (`sha256Hex`, line 89) and
   `AuthDirectives.scala` (`resolveApiToken`, line 41: `ApiTokenService.sha256Hex(token)` — a companion-object
   call, not an instance method). Delegating the body to a new `com.helio.infrastructure.TokenHashing` while
   keeping `ApiTokenService.sha256Hex` as a one-line forwarder leaves this call site's signature and behavior
   identical — confirmed workable. Also checked `ApiTokenRepository.scala` imports (no `com.helio.services`
   import), confirming the stated dependency direction (services → infrastructure) that motivated putting the
   shared helper in `infrastructure` rather than `services`.

4. **Spec delta correctness.** Diffed `openspec/specs/session-persistence/spec.md` (base) against the delta.
   The two schema requirements ("user_sessions table has complete schema", "token index exists for fast
   lookup") are copied in full — all 6+2 original scenarios present, only `token`→`token_hash` renamed where
   the ticket's change actually touches them. The two untouched requirements ("Expired sessions do not
   authenticate", "Sessions can be invalidated server-side on logout") are correctly omitted from the MODIFIED
   section per OpenSpec convention (they're unaffected). "Token stored as secure hash" is tightened
   (algorithm named) and gains two new, concretely testable scenarios (hash-before-compare on lookup;
   pre-existing raw rows deleted not reinterpreted on rollout). Also noted: the *pre-existing base spec*
   already (incorrectly) claimed `token` "SHALL store only a hashed representation" even though current code
   stores it raw — pre-existing spec/code drift this change actually fixes; not a new problem introduced by
   this design (non-blocking note below).

5. **Grep for missed call sites.** Ran broader greps across `backend/src/main`, `backend/src/test`,
   `scripts/`, `notes/`, `docs/` for `user_sessions` / `SessionRow` / `.token`. Only hit: `notes/roadmap.md`
   (a changelog-style line, not code), and the already-accounted-for migrations/test files. No ops script,
   frontend code, or other spec file references the raw column. `openspec/specs/request-authentication/spec.md`
   describes auth behavior in column-agnostic language ("the token MUST exist in the `user_sessions` table")
   that remains true post-rename without edits — correctly left untouched.

### Verdict: CONFIRM

The design is specific, internally consistent, and every load-bearing claim in `design.md`/`proposal.md`
(three call sites, no RLS on the table, migration numbering, test fixtures not inserting raw tokens,
`ApiTokenService.sha256Hex` call site shape) checks out against the actual code, not just the design doc's
narrative. The migration invalidation rationale is argued, not asserted. The repository-boundary hashing
decision correctly accounts for the one subtle spot (`findSession`'s returned domain object must carry the
raw param, not the row's hash) that a shallower design could have missed — tasks 1.6 says this explicitly.

### Non-blocking notes

- The pre-existing base `session-persistence` spec already (wrongly) claimed the `token` column stores "a
  hashed representation" before any code did so. Worth a one-line mention in the PR description that this
  change also corrects a stale spec claim, not just adds a new one — purely cosmetic, doesn't block.
- `SessionTable.token` currently carries a Slick `O.PrimaryKey` annotation that doesn't match the real DB
  PK (`id`, per V11) — pre-existing quirk, out of scope for this ticket, but worth a mental note for whoever
  eventually cleans up `UserRepository`'s Slick mappings.
