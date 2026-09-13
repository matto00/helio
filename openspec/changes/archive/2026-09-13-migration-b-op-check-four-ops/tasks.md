## 1. Migration

- [x] 1.1 Write `backend/src/main/resources/db/migration/V107__add_writeback_ops.sql`: drop and
      re-add `pipeline_steps_op_check` with the existing 23 ops (verbatim from
      `V83__add_assert_op.sql`) plus `upsertsource`, `convertformat`, `analyzewithai`,
      `generatetext`.
- [x] 1.2 As a manual, non-authoritative smoke check only (the real proof is task 2.1/2.2): confirm
      `sbt run`'s Flyway boot applies V107 without error against the local dev DB. Do not treat
      this as sufficient evidence on its own — the shared dev DB is used by other concurrent
      worktrees (see MISTAKES.md), so do not leave the dev server running against it beyond this
      one check if avoidable.

## 2. Safety proofs

- [x] 2.1 Add a migration test (new spec, e.g. `PipelineStepsOpCheckSeededRowsSpec`) that, against
      an isolated `EmbeddedPostgres` instance, applies migrations through V106, seeds one
      `pipeline_steps` row for EVERY ONE of the 23 existing ops (not a sample), then applies V107
      and asserts: every seeded row still passes the CHECK constraint, all four new op strings
      are now insertable, and a bogus/unknown op string is still rejected.
- [x] 2.2 Run the existing `FlywayNonSuperuserMigrationSpec`
      (`backend/src/test/scala/com/helio/infrastructure/persistence/
      FlywayNonSuperuserMigrationSpec.scala`) and confirm it still passes green with V107 added —
      its full-chain `.migrate()` call has no version ceiling, so it will exercise V107
      automatically as the same `helio_migration_test` role (`NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOBYPASSRLS`, owner of every table it creates) without any spec changes. Then add one new,
      narrow negative-case test (e.g. `PipelineStepsOpCheckOwnershipRequiredSpec`) proving a
      DIFFERENT role — same NOSUPERUSER/NOBYPASSRLS/NOCREATEROLE shape, but NOT the owner of
      `pipeline_steps` — is denied when attempting the same drop/re-add of
      `pipeline_steps_op_check`, so the "ownership is what matters, not superuser" claim is
      falsifiable in both directions, not just asserted.
- [x] 2.3 Add a `PipelineService`-level test (extending an existing addStep/validateStepKinds spec
      if one covers the "invalid type" 400 path, else a new one) pinning that, after V107,
      `POST /api/pipelines/:id/steps` (or the underlying `PipelineService.addStep`/
      `validateStepKinds`) still returns `400`/`ServiceError.BadRequest` for each of
      `upsertsource`, `convertformat`, `analyzewithai`, `generatetext` — NOT a test against
      `PipelineAnalyzeService`'s "Unknown op", which fires inside an already-`200` response and
      does not prove API-level rejection.

## 3. Spec parity

- [x] 3.1 Update `openspec/specs/pipeline-steps-persistence/spec.md`'s op CHECK constraint
      requirement text (already stale at 13 of 23 ops before this change) to the full current
      27-op list and add the new scenario documenting that migration V107 alone does not register
      the four new ops at the API — via this change's `specs/pipeline-steps-persistence/spec.md`
      MODIFIED-requirements delta, applied on archive.
- [x] 3.2 No other `openspec/specs/` or `schemas/` file enumerates the master op list (verified by
      grepping every one of the 23 current op names, not just `assert`) — no further spec changes
      needed.

## Standing Constraints

- [C1] Models: sonnet for executor/evaluator, opus for skeptic (driver-mandated override, passed
  explicitly at every spawn).
- [C2] Any gate/cycle budget exhaustion is a mandatory escalation to the driver — never
  self-extend or self-approve past a bound.
- [C3] A REFUTE is cleared only by fixing the underlying defect — never by rewording an
  answer/event so an exact-string check passes.
- [C4] Constraint-accepts-op is not product-accepts-op: this ticket must not add
  `upsertsource`/`convertformat`/`analyzewithai`/`generatetext` to `PipelineStepKind.All`,
  `allowedOps`, apply/infer parity, or StepCard — each op's own ticket wires product support.
