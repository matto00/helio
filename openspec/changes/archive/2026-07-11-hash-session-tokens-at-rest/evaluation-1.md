## Evaluation Report — Cycle 1

### Phase 1: Spec Review — PASS
Issues: none.

- All ticket ACs addressed explicitly: SHA-256 hash stored in `user_sessions.token_hash`
  (V45 migration + `TokenHashing.sha256Hex`); incoming raw token hashed at every lookup
  (`findValidSession`, `findSession`, `deleteSession`); client-facing contract unchanged
  (`AuthService`/`AuthResponse.token` diff is empty — verified); migration invalidates
  existing sessions via `DELETE FROM user_sessions` before the column rename, matching
  the ticket's explicit scope.
- No AC reinterpreted — design.md's decisions (hash at repo boundary, not domain model;
  shared `TokenHashing` in `infrastructure` not `services`; invalidate not rehash) are
  all self-approved, minor, parity-driven, and correctly implemented.
- All 12 tasks in tasks.md verified against the diff line-by-line — all done and matching.
- No scope creep: diff touches exactly the files listed in proposal.md's Impact section
  (`TokenHashing.scala`, `ApiTokenService.scala` one-line delegate, `UserRepository.scala`,
  `UserSessionRepository.scala`, `V45` migration, `ApiRoutesSpec.scala` test additions,
  session-persistence spec delta) plus openspec planning docs. No frontend files touched
  (confirmed via `git diff --stat`).
- No regressions: full `sbt test` run (see Phase 2) is 978/978 green, including the
  pre-existing register/login/logout/`GET /api/auth/me` tests, unmodified.
- No wire-contract/schema changes needed or made — confirmed `api/protocols`,
  `JsonProtocols.scala`, `schemas/`, and `openspec/specs/` (outside the change's own
  session-persistence delta) are untouched in the diff.
- `openspec/specs/session-persistence/spec.md` delta accurately reflects the final
  implemented behavior (SHA-256 explicit, hash-on-lookup scenario, invalidation-on-rollout
  scenario) — matches the code exactly.

### Phase 2: Code Review — PASS
Issues: none.

- **Canonical code-quality compliance**: `npm run check:scala-quality` run fresh — clean,
  0 inline-FQN violations in the new/changed files (36 pre-existing soft file-size
  warnings, none in files touched by this change). `npm run lint` and
  `npm run format:check` both pass clean, run fresh.
- **DRY**: `TokenHashing.sha256Hex` correctly extracted once; `ApiTokenService.sha256Hex`
  is now a one-line delegate (`backend/src/main/scala/com/helio/services/ApiTokenService.scala:86-88`),
  eliminating the previous duplication — matches design.md's stated rationale
  (infrastructure must not depend on services, so the helper lives in
  `com.helio.infrastructure`, and `ApiTokenService` delegates rather than the reverse).
- **Readable**: naming is self-documenting (`tokenHash`, `sha256Hex`), doc comments at
  each touched method explain the HEL-288 hashing boundary and why (e.g.
  `UserRepository.scala:103-108`, `UserSessionRepository.scala:22-23`). No magic values.
- **Modular**: hashing isolated to a single-purpose object; call sites unchanged in shape
  aside from the hash step.
- **Type safety**: no untyped escape hatches introduced.
- **Security**: this *is* the security fix — SHA-256 hex digest computed and compared
  correctly; raw token never persisted; migration invalidates rather than risking a
  forward-hash mismatch. No injection surface introduced (Slick-typed queries throughout,
  parameterized `sql"..."` in the new test).
- **Error handling**: no new failure modes introduced; existing `Future`-based error
  propagation unchanged.
- **Tests meaningful**: new tests genuinely exercise both regression vectors — (1) a
  direct SQL assertion that `token_hash` equals `sha256Hex(raw)` and that a raw-value
  lookup against the column returns zero rows, and (2) a full repository round-trip
  (`createSession`/`findSession`/`deleteSession`/`findValidSession`) confirming a raw
  token matches its hashed row, and that a pre-hashed value does *not* match at
  `findValidSession` (guards against accidental double-hashing or comparing the wrong
  value). These would catch a real regression (e.g. reverting to raw storage, or
  hashing/not-hashing at the wrong boundary).
- **No dead code**: no stray TODO/FIXME, no unused imports in the diff.
- **No over-engineering**: `TokenHashing` is a minimal, appropriately-scoped extraction;
  no premature abstraction (e.g. no pluggable hash-algorithm interface, which would be
  unwarranted here).
- **Behavior-preserving**: `AuthService.scala` diff is empty — confirmed the
  `register`/`login`/`completeOAuth`/`logout` flows and `AuthResponse.token` shape are
  untouched; only the repository-boundary storage representation changed, exactly as
  design.md specifies.
- **Migration correctness**: `V45__hash_session_tokens.sql` is valid Postgres
  (`ALTER TABLE ... RENAME COLUMN` / `RENAME CONSTRAINT` are both valid syntax) and
  matches design.md's stated plan exactly (DELETE, then two renames). The constraint
  name renamed (`user_sessions_token_unique` → `user_sessions_token_hash_unique`) matches
  the exact name created by V11 (`grep`-verified). V45 is the correct next Flyway version
  (V44 is the prior head, no numbering collision). Ran a fresh `sbt test`, which applies
  all 45 migrations against a real embedded Postgres — migration applies cleanly.
  No RLS policy or other migration references the `token` column by name (grep-verified
  across all of `backend/src/main/resources/db/migration/`), so the rename is safe.
- **No stray references to the old column/field name**: grepped
  `backend/src/main/scala` and `backend/src/test/scala` for `user_sessions.token`,
  `row.token`, `SessionRow(token`, `s.token` (old table alias) — the only remaining
  `token` (non-`token_hash`) references are historical migration files (V7/V11, which
  correctly describe the pre-rename schema) and comments describing the raw value
  concept. No live code path references the old column name.
- **Pre-commit bypass verified legitimate**: reproduced `npm run check:openspec`
  independently — it fails with exactly one reason: `change "hash-session-tokens-at-rest"
  is complete (12/12) but not archived`, which is expected mid-pipeline (archiving happens
  later in the workflow). `npm run lint`, `npm run format:check`, `npm run
  check:scala-quality`, and `sbt test` were all re-run fresh by this evaluator (not
  trusting the executor's report) and pass cleanly — confirming the `-n` bypass commit
  message's claim (hygiene check only) is accurate.
- **Gates independently re-run**: `sbt test` → 978/978 succeeded, 0 failed, 58 suites
  completed, migrations apply through V45 cleanly. This matches the executor's reported
  978/978.

### Phase 3: UI Review — N/A
No UI-affecting files changed. Confirmed via `git diff <base>...HEAD --stat`: only
`backend/src/**` and `openspec/changes/hash-session-tokens-at-rest/**` files are touched;
zero files under `frontend/**`; `backend/src/main/scala/routes/ApiRoutes.scala` (note:
actual path is `backend/src/main/scala/com/helio/api/ApiRoutes.scala`) is not in the diff;
no `schemas/**` changes; the only `openspec/specs/**` change is this change's own
session-persistence delta (not a live spec-baseline mutation prior to archive). Dev
servers were not started — no UI-affecting trigger present.

### Overall: PASS

### Non-blocking Suggestions
- None.
