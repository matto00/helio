## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- Ticket AC1 (exact 23+4 op list, verbatim, no drop/typo/dup): verified programmatically — extracted
  the CHECK-constraint op tuples from both `V83__add_assert_op.sql` and
  `V107__add_writeback_ops.sql` and diffed them; the first 23 entries are byte-identical in the
  same order, and the trailing 4 are exactly `upsertsource, convertformat, analyzewithai,
  generatetext` with no duplicates.
- Ticket AC2 (seeded-rows proof against existing rows): `PipelineStepsOpCheckSeededRowsSpec` seeds
  one row per **all 23** existing ops (not a sample; explicit `existingOps` list matches V83's
  list), migrates only to V106 first so seeding happens under the pre-V107 constraint, then applies
  V107 and re-asserts all 23 rows still satisfy the re-added CHECK, all 4 new ops are insertable,
  and a bogus op (`not_a_real_op`) is rejected with a `PSQLException` naming
  `pipeline_steps_op_check`.
- Ticket AC3 (non-superuser role proof): `FlywayNonSuperuserMigrationSpec` re-run fresh (see Phase
  2) shows real log output "Migrating schema 'public' to version '107 - add writeback ops'"
  applied as `helio_migration_test` (non-superuser role), immediately followed by "Successfully
  applied 14 migrations... now at version v107". `PipelineStepsOpCheckOwnershipRequiredSpec` adds
  the falsifying negative case: a same-shaped role that does NOT own `pipeline_steps` is denied
  with real Postgres SQLSTATE `42501` and message `"must be owner of table pipeline_steps"` — not
  a loose exception catch.
- Ticket AC4 (migration alone doesn't unlock the API): `PipelineCreateTransactionalSpec` gained
  four parametrized tests (one per new op) calling `PipelineService.create` end-to-end and
  asserting `ServiceError.BadRequest` with message `"Invalid step type '<op>'"` — this is the real
  `PipelineStepKind.All` gate at `PipelineService.scala:521`, not `PipelineAnalyzeService`'s
  "Unknown op" arm (confirmed by reading `buildStepsAction`, `PipelineService.scala:518-524`).
- Ticket AC5 (no `allowedOps`/StepCard/apply-infer touched): confirmed — `git diff --name-only`
  against main shows only the new SQL migration, 2 new test files, 1 extended test file, and
  OpenSpec artifacts. `grep -rn` for all four new op strings across
  `backend/src/main/scala` and `frontend/src` returns zero hits — no product-level wiring exists
  anywhere in main code.
- Ticket AC6 (schemas/specs updated only where they enumerate op names): `openspec/specs/
  pipeline-steps-persistence/spec.md`'s MODIFIED delta updates the stale 13-op list to the full
  current 27-op list and adds the new "Migration B widens..." scenario documenting the DB/API
  split. Design.md's grep claim (no other spec/schema enumerates a master op list) is consistent
  with what's in the diff — no other spec files touched.
- Tasks.md: all task items (1.1, 1.2, 2.1, 2.2, 2.3, 3.1, 3.2) marked done and each matches what
  was actually implemented per the checks above.
- No scope creep: diff is migration + tests + OpenSpec docs only.
- No regressions: existing 23-op scenarios in `pipeline-steps-persistence/spec.md` are preserved,
  not removed.
- CONSTRAINTS (tasks.md "Standing Constraints"): C4 explicitly verified (see above, zero product
  wiring). C1-C3 are process constraints for agent conduct, not diff-checkable; nothing in the diff
  contradicts them.

### Phase 2: Code Review — PASS

Gates run fresh, in `WORKTREE_PATH` (no `CLEAN_WORKTREE` passed):

- `cd backend && sbt test` — **green**: 4255 tests, 279 suites, 0 failures, 0 errors (4m39s wall).
- Re-ran `FlywayNonSuperuserMigrationSpec` in isolation and captured its own fresh log, confirming
  it genuinely re-applies the full Flyway chain including V107 under the restricted role (see
  Phase 1 AC3) — not trusting the executor's claim in `files-modified.md` alone.
- `node scripts/check-scala-quality.mjs`: clean, 164 pre-existing soft (file-size) warnings only;
  none of the new/modified files in this diff appear in the warning list (all are small,
  well under the 250-line soft budget).

Checklist:
- [x] Canonical code-quality compliance (CONTRIBUTING.md) — no inline FQNs, no mechanical
      violations found by the check script.
- N/A DESIGN.md — no `frontend/**` changes.
- [x] DRY — reuses `FlywayNonSuperuserMigrationSpec` per design decision 2 rather than inventing
      new infra; migration content is a direct verbatim copy of V83, not hand-retyped from memory
      (confirmed via the programmatic diff above).
- [x] Readable — migration comment explains scope boundary and rationale; test names and doc
      comments are clear and specific about what each test proves and why (e.g. distinguishing
      the "constraint accepts it" layer from the "API rejects it" layer).
- [x] Modular — three focused, single-purpose test specs plus one small migration file.
- [x] Type safety — N/A (SQL + Scala test code using existing typed APIs; no untyped escape
      hatches introduced).
- [x] Security — the ownership-required negative test is itself a security-relevant proof (least
      privilege) rather than a gap; migration only widens a CHECK constraint, no injection surface.
- [x] Error handling — tests assert on the *specific* real driver exception/SQLSTATE/message, not
      a broad catch (verified in both new persistence specs).
- [x] Tests meaningful — seeded-rows spec would catch a dropped/mistyped/duplicated op (fails the
      migration itself via constraint violation on existing rows); ownership spec would catch a
      regression in the ownership-vs-superuser causal claim; API-rejection test would catch a
      future accidental addition of these ops to `PipelineStepKind.All` without it being a
      deliberate, reviewed diff.
- [x] No dead code — no unused imports/TODOs in the new/changed files.
- [x] No over-engineering — migration is a direct copy-and-extend; no premature abstraction.
- [x] Behavior-preserving — the migration is additive (widens an allow-list) and does not
      restructure existing behavior; confirmed the 23-op prefix is untouched.
- `files-modified.md`'s "Root cause / debugging notes" section documents two probe-confirmed fixes
  (missing `root_id` on seeded rows; wrong exact Postgres error-message wording) consistent with
  the systematic-debugging law — not guessed fixes.

### Phase 3: UI Review — N/A

No changes under `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` that touch UI-observable behavior (the one `openspec/specs/**` change is the
`pipeline-steps-persistence` op-list text, a persistence-layer spec, not an API-route or
schema-shape change). No dev servers started; not required.

### Overall: PASS

### Non-blocking Suggestions
- None of substance. `PipelineCreateTransactionalSpec.scala` is now 657 lines (already over the
  250-line soft budget before this change, per the quality-check output); this ticket added a
  reasonable, cohesive 23-line block to it and splitting is not something this ticket should be
  asked to do.
