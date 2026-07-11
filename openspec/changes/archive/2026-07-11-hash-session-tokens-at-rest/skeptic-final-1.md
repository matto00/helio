## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **Ticket/spec/design read**: `ticket.md`, `design.md`, `tasks.md`, `files-modified.md`,
  `specs/session-persistence/spec.md`, and the evaluator's `evaluation-1.md` — treated as
  claims, verified independently below.

- **End-to-end raw-token trace (AC: nothing persists a raw session token)**:
  - `AuthService.register`/`.login`/`.completeOAuth` (`backend/.../services/AuthService.scala`)
    all call `AuthService.buildSession` (raw token from `generateSessionToken()`) then
    `userRepo.createSession(session)` — diff-empty for this file, confirmed by reading it in
    full: session-minting logic and `AuthResponse.token = session.token` are untouched.
  - `UserRepository.createSession` (`infrastructure/UserRepository.scala:108-116`) hashes via
    `TokenHashing.sha256Hex(session.token)` into `SessionRow.tokenHash`, and returns the
    *original* `session` (raw token) unchanged — confirmed by direct read, not diff summary.
  - `SessionTable` (`UserRepository.scala:165-171`) maps Scala field `tokenHash` to SQL column
    `token_hash` — the row type has no field carrying the raw value at all; it is structurally
    impossible to persist raw via this path.
  - `findSession`/`deleteSession` (logout path) and `SlickUserSessionRepository.findValidSession`
    (hot per-request auth path, `AuthDirectives.resolveBearer`) all hash the incoming raw token
    via `TokenHashing.sha256Hex` before any SQL comparison — read directly, not asserted.
  - `AuthDirectives.scala` read in full: `resolveBearer`/`resolveApiToken` are unchanged aside
    from being the same call sites design.md describes; `ApiTokenService.sha256Hex` correctly
    delegates to `TokenHashing.sha256Hex` (one-line, read directly).
  - **Verdict on AC 1: satisfied**, traced to real code, not narrative.

- **Migration correctness and Flyway versioning**: listed
  `backend/src/main/resources/db/migration/` myself (`ls | sort -V`) — V45 is the correct next
  free version (V44 is the prior head, no gap/collision). Read `V45__hash_session_tokens.sql`
  in full: `DELETE FROM user_sessions;` then `ALTER TABLE ... RENAME COLUMN token TO
  token_hash;` and `ALTER TABLE ... RENAME CONSTRAINT user_sessions_token_unique TO
  user_sessions_token_hash_unique;` — both are valid standalone Postgres DDL, and the
  constraint name matches the one created in `V11__user_sessions_complete.sql:15`
  (`CONSTRAINT user_sessions_token_unique UNIQUE (token)`), grep-verified myself.

- **No stray old-column references**: grepped `backend/src/main/scala` and
  `backend/src/test/scala` for `.token\b` (excluding `tokenHash`/`token_hash`/API-token
  terms) — the only hits are `DataSourceProtocol.scala` (unrelated REST-auth `token` field,
  pre-existing), a doc comment, and `AuthService.scala:123` (`session.token`, which is the
  *domain* raw-token field, correct per design's explicit "hash at repo boundary, not domain
  model" decision — not a stray reference to the DB column). Grepped every migration file
  touching `user_sessions` (`V7`, `V11`, `V17`, `V42`, `V45`) — none besides V7/V11 (pre-rename,
  correctly describing the old schema) and V45 (the rename itself) reference the `token`
  column; no RLS policy anywhere references it.

- **Test additions read in full** (`ApiRoutesSpec.scala:2317-2367`): (1) a real register →
  DB-row assertion that `token_hash` equals `sha256Hex(rawToken)` and that a raw-value lookup
  against the column returns 0 rows; (2) a full repository round-trip
  (`createSession`/`findSession`/`deleteSession`/`findValidSession`) that also asserts an
  *already-hashed* value does NOT match at `findValidSession` (catches double-hashing/wrong-
  boundary regressions). These would genuinely fail if the fix were reverted or misapplied —
  not vacuous.

- **Gates re-run myself, fresh, not trusted from evaluator's report**:
  - `sbt test` (from `backend/`): **978/978 succeeded, 0 failed**, 58 suites, migrations
    applied 1→45 cleanly against a real embedded Postgres (full Flyway log inspected — V45
    "hash session tokens" applied without error).
  - `npm run lint` → clean (0 warnings). `npm run format:check` → clean.
  - `npm run check:scala-quality` → clean; the 36 soft file-size warnings listed are
    pre-existing files unrelated to this change's touched files (`TokenHashing.scala`,
    `UserRepository.scala`, `UserSessionRepository.scala`, `ApiTokenService.scala` are not
    among them).

- **Diff scope, computed against the true parent commit** (`1f4519f`, the actual commit
  immediately preceding `1367eab HEL-288 ...` in `git log`, not the stale `761707b` reference
  in the task brief which predates several unrelated merged tickets): `git diff
  1f4519f...HEAD --stat` shows exactly `TokenHashing.scala` (new), `UserRepository.scala`,
  `UserSessionRepository.scala`, `ApiTokenService.scala`, `V45__hash_session_tokens.sql`,
  `ApiRoutesSpec.scala` (+55 lines), and the openspec change-directory artifacts. Zero
  `frontend/**` files touched — matches `files-modified.md`'s claim, verified directly rather
  than trusted.

- **Bypass commit legitimacy**: read the commit message on `1367eab` in full — cites `-n`
  bypass with the specific reason "check:openspec's complete-but-not-archived hygiene check."
  Reproduced `npm run check:openspec` myself: it fails with exactly one issue — `change
  "hash-session-tokens-at-rest" is complete (12/12) but not archived`. No other issue. This
  matches CLAUDE.md's exception (archiving happens later in the pipeline); the commit
  message explicitly calls out the bypass and its scope, satisfying "call it out explicitly."
  No separate fix commit expected yet, consistent with the brief.

- **UI/design judgment**: N/A — confirmed via the scoped diff above that zero `frontend/**`
  files are touched. No dev-server visual check required.

### Verdict: CONFIRM

### Non-blocking notes
- The task brief's reference commit (`761707b`) is stale for diff purposes on this worktree
  (several unrelated tickets — HEL-292/293/294/295/296/297 — merged to main between it and
  this branch's base). Future final-gate runs should diff against the immediate parent
  commit (`git log --oneline -2`) rather than a fixed SHA, to avoid a misleadingly large
  diff. Not a defect in this change — just a note for the harness.
