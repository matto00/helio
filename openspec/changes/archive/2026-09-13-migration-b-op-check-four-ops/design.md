## Context

`pipeline_steps.op` is guarded by `pipeline_steps_op_check`, a CHECK constraint with no
`ALTER CONSTRAINT` path in PostgreSQL — every op addition since V50 has dropped and re-added
the whole constraint (V50, V51, V52, V64-V72, V83). The current list (from
`V83__add_assert_op.sql`, the latest migration to touch it) is: rename, filter, join, compute,
groupby, cast, select, limit, sort, aggregate, splittext, extractheadings, chunkbytokencount,
datebucket, pivot, window, unpivot, dedupe, fillnull, stringops, union, lookup, assert (23 ops).

Migration B is one of two migrations in the v0.8 write-back design
(`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`); Migration A
(the `dataset` primitive) already shipped as V106__dataset_rows.sql. Main's highest migration
is V106, so this migration is V107 (assigned by the batch driver as the single owner of this
constraint for this delivery window, per the ticket's "one migration, one lane" note).

Op-level product wiring (StepCard, `allowedOps`, apply/infer parity) is explicitly NOT part of
this ticket — `PipelineAnalyzeService`'s op match (`backend/src/main/scala/com/helio/domain/
engine/PipelineAnalyzeService.scala`) has no case for any of the four new op strings and falls
through to its `case unknown => ... "Unknown op: '$unknown'"` arm, so the DB accepting the
string does not make the API accept a step using it.

## Goals / Non-Goals

**Goals:**
- Widen `pipeline_steps_op_check` to accept `upsertsource`, `convertformat`, `analyzewithai`,
  `generatetext` without dropping or corrupting any of the existing 23 ops.
- Prove the migration is safe to apply in production: under the non-superuser `helio` Flyway
  role, and against a table already holding rows for existing ops (so the re-added CHECK must
  validate them, not just accept new inserts).
- Pin, with a test, that this migration alone does not change product-visible op acceptance
  (API still rejects the four new ops with "Unknown op").

**Non-Goals:**
- Implementing `upsertsource`/`convertformat`/`analyzewithai`/`generatetext` behavior, their
  Step classes, apply/infer cases, `allowedOps` list membership, or StepCard UI — each has its
  own ticket (HEL-1099, 1105, 1106, 1107).
- Any `schemas/`/`openspec/specs/` changes — neither enumerates the full op allow-list as a
  spec-level contract (grep confirms `assert` only appears in `pipeline-assert-op` and
  `mcp-assert-step-authoring`, which describe that op's own behavior, not a master op list).

## Decisions

1. **Migration content is a straight copy of V83's constraint shape**, replacing the op tuple
   with the 23 existing ops plus the four new ones, in the same drop/re-add form. No op is
   reordered, renamed, or dropped — verified against `V83__add_assert_op.sql` directly rather
   than from memory, since a dropped op here would break existing pipelines silently.
2. **Non-superuser-role proof reuses the already-established `FlywayNonSuperuserMigrationSpec`**
   (`backend/src/test/scala/com/helio/infrastructure/persistence/
   FlywayNonSuperuserMigrationSpec.scala`, HEL-943/HEL-913/HEL-1074's standing regression gate) —
   no new test infrastructure is invented, because this exact scenario (the full Flyway chain,
   run AS a role shaped like production's `DB_USER=helio`: `LOGIN NOSUPERUSER NOCREATEDB
   NOCREATEROLE NOBYPASSRLS`, owner of every table it creates) is already proven there. That spec
   pre-creates `helio_privileged BYPASSRLS NOLOGIN` and grants it to the restricted role `WITH
   ADMIN OPTION` before Flyway ever runs — exactly what makes V34's own `CREATE ROLE
   helio_privileged BYPASSRLS` a no-op (the role already exists) and its trailing `GRANT
   helio_privileged TO current_user` succeed, without the restricted login role itself ever
   needing `CREATEROLE`. Because that same role creates every table across the whole chain
   (V1-onward), it is already the owner of `pipeline_steps` by the time V107 runs — table
   ownership, not superuser or `CREATEROLE`, is what `DROP CONSTRAINT`/`ADD CONSTRAINT` actually
   requires. This spec's second `.migrate()` call carries no `.target(...)` ceiling, so it already
   applies every migration through whatever is current on `main` — V107 is exercised
   automatically the moment it exists on disk, with zero spec changes required; if
   `helio_migration_test`'s ownership were somehow insufficient for a bare CHECK-constraint
   drop/re-add, this spec would fail loudly right at V107. Task 2.2 below adds one deliberately
   narrow negative case on top of that existing coverage: a role that does NOT own
   `pipeline_steps` is denied when attempting the same drop/re-add, to make the
   ownership-is-what-matters causal claim falsifiable in both directions, not just asserted.
   This design makes no claim about production's own undocumented bootstrap mechanism for
   `helio_privileged` (not found in `infra/`) — only that ownership, not privilege escalation, is
   the operative requirement, which is what the existing spec's already-passing chain (through
   V106) already establishes and V107 inherits unchanged. See `MISTAKES.md`'s V0.7.x RLS/role
   incident: every prior "it works locally" check ran as the dev superuser and masked exactly
   this class of privilege gap — this spec is the standing fix for that class of gap, reused
   here rather than re-invented.
3. **Existing-rows validation seeds one `pipeline_steps` row for every one of the 23 current ops**
   (not a sample) before applying V107, then asserts every seeded row still passes the re-added
   CHECK and that a bogus/unknown op string is still rejected after V107 — a re-added CHECK
   constraint validates every existing row, so this is the only way to prove the copied op list
   is complete, correctly quoted, and not accidentally permissive.
4. **The "still rejected at the API" pin is a Scala test at the step-creation service boundary,
   not at `PipelineAnalyzeService`.** `PipelineAnalyzeService`'s per-step "Unknown op" arm only
   fires inside an already-`200` analyze response body and is the wrong layer to prove API
   rejection. The real gate is `PipelineStepKind.All.contains(...)` in
   `PipelineService.addStep`/`validateStepKinds` (`backend/src/main/scala/com/helio/services/
   pipelines/PipelineService.scala:521,1495`), which returns `ServiceError.BadRequest` (surfaced
   as the route's existing `400` — see `pipeline-steps-persistence`'s "Returns 400 for invalid
   type discriminator" scenario) before analyze ever runs. The test asserts
   `POST /api/pipelines/:id/steps` (or the underlying `PipelineService.addStep`/
   `validateStepKinds` call directly) returns `400`/`BadRequest` for each of the four new op
   strings post-migration — this is the executable form of the ticket's implicit scope boundary,
   so a future op-wiring ticket adding the case to `PipelineStepKind.All` is a deliberate,
   visible diff rather than a silent regression.

## Risks / Trade-offs

- **Risk:** the "still rejected at the API" test asserts at the wrong layer (analyze's
  info-level "Unknown op" instead of the actual `400`-producing guard) and passes without
  proving anything. **Mitigation:** Decision 4 pins the test to `PipelineStepKind.All`/
  `addStep`/`validateStepKinds`, the guard that actually produces the route's `400`.
- **Risk:** applying V107 through `sbt run` against the shared dev database (used by every
  concurrent worktree) could apply a not-yet-reviewed migration to a database other lanes
  depend on. **Mitigation:** the safety-proof tests (tasks 2.1-2.3) run against an isolated
  `EmbeddedPostgres` instance, never the shared dev DB; the shared-dev-DB `sbt run` boot check
  is now a manual, non-authoritative smoke check only (see tasks.md task 1.2).
- **Risk:** a hand-copied op tuple silently drops or mistypes an existing op, breaking pipelines
  using it. **Mitigation:** Decision 1's direct diff against V83, plus Decision 3's full-23-op
  seeded-row validation, which would fail loudly (constraint violation) on any accidental
  omission.
- **Risk:** migration works under the dev superuser but fails under production's constrained
  role. **Mitigation:** Decision 2's full-chain restricted-role `EmbeddedPostgres` test, which
  runs Flyway itself (not just app queries) under a role asserted non-superuser/non-BYPASSRLS,
  per the standing V0.7.x-incident lesson that superuser-run local/CI checks mask exactly this
  gap.
- **Trade-off:** this migration is inert on its own (no op actually usable) until each op's own
  ticket lands — accepted per the ticket's explicit AC ("all four ops are accepted by the
  constraint"; product wiring is out of scope), and now pinned by a test at the correct
  (`PipelineStepKind.All`) layer per Decision 4.

## Planner Notes

- V107 was assigned by the batch driver (ledger owner across concurrent lanes) rather than
  self-selected, per the ticket's explicit "do not hardcode the V number" instruction and the
  driver's own re-verification that V106 is main's current highest migration.
- `pipeline-steps-persistence` is the one capability with a spec-level master op-list contract
  (openspec/specs/pipeline-steps-persistence/spec.md); it was already stale (13 of 23 ops) before
  this change. Every other op-specific spec (pipeline-assert-op, pipeline-date-bucket-op,
  pipeline-lookup-op, pipeline-sort-op, pipeline-string-ops-op, pipeline-union-op) describes only
  its own op's behavior, confirmed by grepping every one of the 23 current op names (not just
  `assert`) across `openspec/specs/` and `schemas/` — no other master list exists. `skip_specs`
  is therefore NOT set; a MODIFIED-requirements delta for `pipeline-steps-persistence` is
  included in this change instead.
