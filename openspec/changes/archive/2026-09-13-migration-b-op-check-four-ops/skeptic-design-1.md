## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 9f7bd3838452cb7e76393e6b4fc38d171297c239 (no implementation commits yet).

### What I verified (with evidence)
- **23-op list: ACCURATE.** `backend/src/main/resources/db/migration/V83__add_assert_op.sql` CHECK tuple matches the ticket/design list exactly, in order. V83 is the latest migration touching `pipeline_steps_op_check` (`grep -l op_check` → V71, V72, V83 tail). Highest migration is V106__dataset_rows.sql, so V107 is free.
- **None of the four new op strings exist anywhere yet** in backend/frontend/schemas (grep, zero hits).
- **"Unknown op" fall-through: TRUE, but at the wrong layer for the claim made.** `PipelineAnalyzeService.scala:466-485` has no case for the four ops and hits `case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`. However, the real API gate is `PipelineStepKind.All`. `PipelineService.scala:~1295` documents that `addStep` and proposal analyze reject an unregistered `type` with `ServiceError.BadRequest` (400) *before* analyze runs. Analyze's "Unknown op" is only a per-step `validationError` inside a 200. So a test pinning analyze's string does not show "the API does not accept a step using the op".
- **"No schemas/ or openspec/specs/ master op list": FALSE.** `openspec/specs/pipeline-steps-persistence/spec.md:16` says: "`op` (TEXT with CHECK constraint: one of 'rename', … 'chunkbytokencount')". That is an enumeration of this exact constraint, already stale at 13 ops. The design grepped only for `assert`, so it missed this. The ticket's last AC says "verified, not assumed", and this claim fails that bar.
- **Non-superuser proof: under-specified.** The repo already has a concrete pattern in `RlsSharingAwareTablesSpec.scala:22-104` (EmbeddedPostgres, `CREATE ROLE ... NOSUPERUSER`, `SET ROLE`). The plan doesn't cite it. Task 2.2 also says "applies V107 (or exercises the resulting constraint)". That "or" lets someone test only INSERTs, which proves nothing about the DDL privilege, and the DDL privilege is exactly the risk from the V0.7.x incident (MISTAKES.md:154-159). There is also no negative control showing the role really is constrained.
- **Task 1.2 runs `sbt run` Flyway against the shared dev DB.** MISTAKES.md:144-148 says worktrees share `flyway_schema_history`. V100's header says validation is on. Applying V107 there can break other lanes whose branches lack V107.
- **skip_specs: true** is defensible for behavior. But because `pipeline-steps-persistence` spec.md:16 enumerates the constraint, that spec text must be updated anyway (or a spec delta used), so "no spec changes" can't stand as written.
- tasks.md ends with an empty "## Standing Constraints" heading (cosmetic).

### Verdict: REFUTE

### Change Requests
1. **Fix the spec-parity claim.** design.md (Non-Goals) and tasks.md 3.1 say no spec enumerates the op list. `openspec/specs/pipeline-steps-persistence/spec.md:16` does. Plan an update so that line lists all 27 ops after V107 (or drop the enumeration and point to the latest migration). Decide whether that is a spec delta (then `skip_specs` needs revisiting) or a hygiene edit, and state which. Redo the grep for every op name, not just `assert`, and record the command and hits.
2. **Retarget the "not accepted by the API" pin (task 2.3 / Decision 4).** The real gate is `PipelineStepKind.All`: `POST /api/pipelines/:id/steps` and proposal analyze return 400 for an unregistered type. Pin at that level, e.g. a route/service test showing `POST .../steps` with `type: "upsertsource"` (and the other three) returns 400. An analyze-string assertion can be kept as secondary, but it can't be the only proof.
3. **Make the role proof concrete (task 2.2 / Decision 2).** Drop the "or exercises the resulting constraint" escape hatch. Specify:
   - (a) Run the V107 `ALTER TABLE … DROP/ADD CONSTRAINT` itself (or Flyway `migrate` to V107) under a `NOSUPERUSER NOBYPASSRLS` role that owns `pipeline_steps` (`ALTER TABLE pipeline_steps OWNER TO <role>` after migrating to V106 as superuser, then `SET ROLE`), reusing the `RlsSharingAwareTablesSpec` / `RlsOwnerTablesSpec` EmbeddedPostgres pattern.
   - (b) Assert `rolsuper = false` and `rolbypassrls = false` for `current_user` inside the test.
   - (c) Add a negative control: the same ALTER under a non-owner non-superuser role fails with a permission error. This proves the harness really drops privilege.
   - (d) Record whether prod's `helio` actually owns `pipeline_steps` (cite V1 or the deploy docs), since "ownership is sufficient" only protects prod if that is true.
4. **Replace task 1.2's shared-dev-DB `sbt run` apply** with the isolated EmbeddedPostgres migration test (2.1/2.2). If a dev-DB boot is still wanted, say how it avoids poisoning other lanes' `flyway_schema_history` (MISTAKES.md:144-148).
5. **Make task 2.1 concrete.** Define "representative sample": seed at least one row per op for all 23 existing ops (cheap, and it is the only way the seeded-row check catches a single dropped op, as Decision 3 claims). Also assert an invalid op (e.g. `'bogus'`) is still rejected after V107, so the test would catch a constraint that was dropped and never re-added.

### Non-blocking notes
- Remove the empty "## Standing Constraints" heading in tasks.md.
- Keep V83's header-comment style (list prior drop/re-add migrations) in V107.
