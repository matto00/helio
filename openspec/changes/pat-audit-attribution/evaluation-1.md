## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All 4 ticket acceptance criteria addressed explicitly and verified against live-executed tests
  (not just claimed): session-cookie → `source=ui`/null token id (`AuthDirectivesSpec`,
  `AuditMutationInstrumentationSpec`); PAT bearer → `source=pat`/correct token id (same specs);
  revocation-preserves-attribution (`AuditMutationInstrumentationSpec`'s "leave a
  previously-recorded audit row's actor_token_id intact after the token is revoked"); ScalaTest
  coverage for both paths plus MFA-via-PAT and scheduler-via-system (tasks 4.1-4.5).
- No AC silently reinterpreted. Decision 5's split of `AuthService` (session-only, `Ui`/`None`
  correctly unchanged) vs. `MfaService` (three PAT-reachable call sites updated, two
  identity-establishing call sites correctly left at default) is implemented exactly as designed
  and independently verified by diff read — `confirmEnrollment`/`regenerateBackupCodes`/`disable`
  pass `user.source`/`user.tokenId`; `establishSession`/`recordFailedAttempt` are untouched.
- All 18 task items in tasks.md are marked done and match what the diff actually contains — spot
  checked task 2.4 (test fakes), task 3.4 (scheduler), task 5.1/5.2 (verification greps) by
  re-running the same greps myself rather than trusting the checkbox.
- No scope creep: diff touches exactly the files listed in files-modified.md (18 main + test files
  + planning artifacts). No unrelated refactors.
- No regressions to existing behavior: full `sbt test` suite (3443 tests) passes, including
  pre-existing `RateLimitDirectiveSpec` and `AuthDirectivesSpec` cases untouched by this ticket.
- No API contract/schema changes needed or made — audit store schema (HEL-471) is unchanged, as
  scoped; `AuthenticatedUser` is an internal domain type, not a wire type, so no JSON protocol
  changes were required, and none were made.
- Planning artifacts (design.md Decisions 1-7, tasks.md) accurately reflect the final implemented
  behavior — verified line-by-line against the diff, not just skimmed.

### Phase 2: Code Review — PASS
Issues: none.

Gates re-run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE`, standard speed):
- `sbt compile test` (targeted): 60/60 passed across the 4 directly-relevant specs.
- `sbt compile test` (full suite, independently re-run by me, not the executor's report): **3443
  passed, 0 failed**, `Total time: 187s`, exit code 0 — matches the executor's claimed count
  exactly, evidence-gated per `verification-before-completion`.
- `npm run check:scala-quality`: clean (134 pre-existing soft file-size warnings, none from this
  diff's files; no inline-FQN violations).
- Frontend gates (lint/format/test/build) not applicable — confirmed via `git diff --name-only
  main...HEAD`: zero files under `frontend/**`. This is a backend-only change as the orchestrator
  stated.

Code-quality checks against CONTRIBUTING.md and the diff:
- **Imports & Qualifiers [mechanical]**: all new imports (`AuditSource`, `ApiTokenId` additions in
  `AuthDirectives.scala`, `MfaService.scala`, `PipelineSchedulerService.scala`,
  `AuthDirectivesSpec.scala`, `AuditMutationInstrumentationSpec.scala`) are top-of-file, no inline
  FQNs introduced — confirmed both by diff read and by the mechanical `check:scala-quality` gate
  passing clean.
- **DRY**: `resolveApiToken`/`resolveIdentity` reuse the existing `.copy()` pattern rather than
  duplicating `AuthenticatedUser` construction; `findUserByTokenHash`'s extension mirrors
  `findPrincipalByTokenHash`'s already-proven query shape per Decision 2, not a fresh
  reimplementation.
- **Readable**: naming (`source`, `tokenId`, `resolvedOpt`) is clear; no magic values; the intent
  of each Decision-driven edit is documented inline where non-obvious (scheduler comment,
  `findUserByTokenHash`'s doc comment).
- **Modular**: provenance resolution stays centralized in `AuthDirectives`, not pushed into
  `UserSessionRepository` (Decision 3) — correct separation of concerns confirmed by the diff.
- **Type safety**: `AuditSource` is a closed ADT; `Option[ApiTokenId]` used correctly throughout;
  no untyped escape hatches introduced.
- **Security**: no new input-validation or injection surface — this is an internal
  attribution-plumbing change, not new externally-facing input handling.
- **Error handling**: unchanged; `findUserByTokenHash`'s `Option` handling and `AuditService`'s
  existing failure-isolation behavior (audit-write failures don't fail the underlying mutation,
  covered by a pre-existing test) are untouched.
- **Tests meaningful**: the new tests exercise real HTTP round-trips through embedded Postgres
  (`AuditMutationInstrumentationSpec`, `PipelineSchedulerServiceSpec`) rather than mocking away the
  behavior being verified — e.g. the revocation test actually calls `DELETE
  /api/tokens/:id` and re-reads the audit row afterward, which would catch a real cascade-delete
  regression if one were introduced.
- **No dead code**: `AuditSource.Mcp` remains an intentionally unused ADT member per the
  ticket/design's documented Non-Goal — verified via `grep -rn "AuditSource.Mcp"
  backend/src/main/scala` returning zero hits, exactly as task 5.2 claims. No leftover
  TODO/FIXME/unused imports introduced.
- **No over-engineering**: Decision 1's approach (thread provenance through the existing
  `AuthenticatedUser` rather than a second parallel parameter) is the minimal-surface option; the
  two genuinely-special call sites (`AuthService`/`MfaService`) are handled with individually
  justified decisions rather than forcing a one-size-fits-all abstraction.
- **Behavior-preserving where expected**: `findPrincipalByTokenHash` (HEL-369, scoped-token path)
  is confirmed untouched, exactly as Decision 2 states — this is a mechanical extension, not a
  refactor, and no drive-by behavior changes were found in the 13 mechanical call-site edits (each
  is a one-line `None, AuditSource.Ui` → `user.tokenId, user.source` substitution, verified across
  all 13 sites).
- **Test-fake integrity check** (explicit focus item): `AuthDirectivesSpec.scala:40` and
  `RateLimitDirectiveSpec.scala:50` both preserve their prior lookup semantics exactly — the former
  now returns `Some((patUser, patTokenId))` instead of `Some(patUser)` for the same hash-match
  condition; the latter's `resolvable.get(hash).map { case (user, tokenId, _) => (user, tokenId)
  }` still keys off the identical map and still drops the third (`scope`) element it never used —
  neither fake weakens or removes any assertion the pre-existing tests relied on, confirmed by the
  unmodified pre-existing test cases in both specs (`should resolve a PAT bearer token...`, `should
  keep two PATs belonging to the SAME user independently budgeted`, etc.) continuing to pass
  unchanged.

### Phase 3: UI Review — N/A
Confirmed, not silently skipped: `git diff --name-only main...HEAD` contains zero paths under
`frontend/**`, and `backend/src/main/scala/routes/ApiRoutes.scala` (note: the actual file is
`backend/src/main/scala/com/helio/api/http/ApiRoutes.scala` in this repo's layout) was not
structurally changed by this diff — `ApiRoutes.scala` itself is untouched (the executor's own
`files-modified.md` does not list it, and `git diff --stat` confirms). `schemas/**` and
`openspec/specs/**` (pre-existing archived specs) are also untouched by this change (only the new
`openspec/changes/pat-audit-attribution/**` change-scoped spec delta was added, which is planning
artifact, not the live spec tree). None of Phase 3's triggers match — this is correctly N/A, not a
skip.

### Overall: PASS

### Non-blocking Suggestions
- `PipelineSchedulerServiceSpec`'s new `sql"...".as[(String, Option[String])]` raw-SQL query reads
  `audit_events` directly rather than through `AuditEventRepository`'s typed accessor (if one
  exposes `source`/`actorTokenId` already) — fine as written since it is asserting on the literal
  stored column values, but worth a passing glance next time `AuditEventRepository` gains a richer
  query API to see if this could become a typed read instead of raw SQL.
