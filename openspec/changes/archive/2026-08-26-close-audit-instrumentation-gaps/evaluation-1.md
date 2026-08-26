## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
Issues: none.

- All three ticket acceptance criteria addressed explicitly:
  - Google OAuth first-time signup now writes `auth.register` (via `wasCreated` returned from
    `upsertGoogleUser`), returning login writes no spurious row.
  - `DataSourceService.refresh` writes exactly one `data_source.refresh` row per call, on success
    only, at the public entry point (`.map` over the dispatch `Future`), covering all five kinds
    (static/csv/text/pdf/image) via the shared dispatch match.
  - `SourceService.refresh` writes exactly one `data_source.refresh` row per call for both sql and
    rest, using `sourceId.value` (the pre-dispatch `DataSourceId` param) rather than the returned
    `DataType.id` — this matches design.md's explicit skeptic-round-1 correction and is verified in
    the diff (`SourceService.scala:152`, `audit(Some(sourceId.value), user, "data_source.refresh")`).
- No AC silently reinterpreted; all six task items in tasks.md §1 and seven in §2 are marked done
  and match the diff.
- No scope creep: changes are confined to the three named files plus their tests plus
  `route-audit-enumeration.md`. Verified `git diff --stat` — no unrelated files touched.
- `route-audit-enumeration.md`'s tracked-gaps section (moved to
  `openspec/changes/archive/2026-08-26-instrument-audit-mutations/route-audit-enumeration.md`) is
  updated: items 1 and 2 marked "Closed (HEL-840)", item 3 confirmed "Closed (HEL-838)" (pre-existing,
  unedited by this ticket other than the closing summary line).
- Spec delta (`specs/audit-mutation-instrumentation/spec.md`) accurately reflects the implemented
  behavior for all three requirements/scenarios.
- No regressions: full backend suite (3473 tests) passes, including all pre-existing
  `AuthServiceSpec`/`DataSourceServiceSpec`/`SourceServiceSpec`/`GoogleOAuthRoutesSpec` cases
  (task 2.7 verified).

### Phase 2: Code Review — PASS
Issues: none.

Gates run fresh in `WORKTREE_PATH` (no `CLEAN_WORKTREE` at this speed):
- `sbt test` (full suite): 3473 tests, 220 suites, 0 failures.
- `npm run check:scala-quality`: clean, 0 mechanical violations (135 pre-existing informational
  file-size soft-warnings, none newly introduced by this diff's files).
- No `frontend/**` files changed (`git diff --name-only main...HEAD` — zero frontend paths), so
  frontend gates (lint/format/test/build) do not apply.

Checklist:
- **Canonical code-quality compliance**: no inline FQNs introduced; new imports in
  `GoogleOAuthRoutesSpec.scala`/`AuditMutationInstrumentationSpec.scala` are top-of-file. File-size
  budgets: both edited test files grow but neither newly crosses the ~400-line "propose a split"
  threshold as a direct result of this diff in a way flagged by the tool.
- **DRY**: `SourceService`'s `audit` helper widened (not duplicated) to take an `action` param with
  a default preserving the two existing call sites; `GoogleOAuthRoutesSpec`'s new
  `allAuditRows`/`eventuallyAuditRows` helpers explicitly documented as mirroring
  `AuditMutationInstrumentationSpec`'s existing pair — reasonable, since sharing across spec files
  isn't established practice in this codebase and doing so here would be a larger unrequested
  refactor.
- **Readable**: `wasCreated` naming, `data_source.refresh` action, `.map` gating on `Right` are all
  self-evident; no magic values.
- **Type safety**: `Future[(User, Boolean)]` change is fully typed end to end; no `.asInstanceOf`/`Any`.
- **Error handling**: `Left` results correctly bypass the audit call at both refresh entry points
  (`.map { case r @ Right(...) => ...; case l => l }`), matching design.md Decision 1's "no separate
  error-path code needed" claim.
- **Tests meaningful**: refresh coverage exercises all 5 DataSourceService kinds + both
  SourceService kinds, both success and one representative failure path per service, with fresh
  `sbt test` proving green.
- **Negative-assertion barrier used correctly everywhere required**: verified by reading every "no
  row" test in both edited spec files (`GoogleOAuthRoutesSpec`'s returning-login case,
  `AuditMutationInstrumentationSpec`'s failed static/csv/sql/rest refresh cases) — each issues a
  real second audited mutation, calls `eventuallyAuditRows` on that second row first to prove the
  write path drained, and only then asserts the count for the row under test. None asserts
  immediately after the call under test.
- **`SourceService.refresh` resourceId correctness**: confirmed via diff read —
  `audit(Some(sourceId.value), user, "data_source.refresh")` uses the pre-dispatch
  `DataSourceId` parameter, not `DataType.id` from the `Right(_)` result (the `case r @ Right(_) =>`
  pattern doesn't even bind the inner value). Matches design.md's explicit correction.
- **No dead code**: no leftover TODO/FIXME, no unused imports (scala-quality check clean).
- **No over-engineering**: no new abstraction beyond widening one existing helper.
- **Behavior-preserving where expected**: `upsertGoogleUser`'s two branches preserve their existing
  update/insert logic exactly, only adding the `Boolean` to the return tuple.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**`, or `openspec/specs/**` files changed — this is a
backend-only, non-route-shape change (existing routes' behavior is extended, not their contracts).

### Overall: PASS

### Non-blocking Suggestions
- None of substance. The two edited spec files (`DataSourceServiceSpec.scala` at 784 lines,
  `AuditMutationInstrumentationSpec.scala` growing further) are already well over the informational
  soft budget pre-existing this ticket; not a blocker per CONTRIBUTING.md's own text ("informational
  only"), but a natural target if a future ticket ever proposes a split.
