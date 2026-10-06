## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, specs/node-payload-history/spec.md,
specs/output-history-api/spec.md, all against the live tree at HEAD d9473814f16df0c54ef76117c00ce9c071297b2b
(worktree is clean apart from the untracked change dir). Owner rulings Q1/Q2, D1–D10 and the HEL-1285
exclusion were treated as settled.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/opt-in-payload-history/HEL-1276`.
- **Round-3 change request resolved.** The output-history-api scenario "Public payload path does not exist" and task
  6.7 now assert `handled shouldBe false` for `PublicDashboardRoutes` alone and `401` with no row data on the full
  `ApiRoutes` tree. I re-checked the composition myself:
  - The public history route is `pathPrefix(Segment / "history") { pathEndOrSingleSlash ...` (PublicDashboardRoutes.scala:412-413).
  - `ApiRoutes.scala:872` uses `optionalAuthenticate { PublicDashboardRoutes ... }`, and `:883` uses `authenticate { ... }`.
  - The spec's 401 is therefore what the live composition produces. Round-3 non-blocking notes 1-2 (age==0 in
    D-3 step 2, and "at most ONE row" wording) are also fixed.
- **V116 is free.**
  - `origin/main` and the worktree stop at V115.
  - A `ls-tree` scan of all 35 `refs/remotes/origin/*` and all local `refs/heads/*` found no `V11[6-9]__*`.
  - No other local worktree has a V116 file.
- **V116 ALTER, FK and RLS interaction.**
  - V115 (read in full) creates `output_snapshot_history` with UUID PK, ENABLE+FORCE, 4 policies on
    `helio_can_access_pipeline` and an explicit grant to `helio_privileged`. D-1 mirrors that exactly.
  - `ADD COLUMN payload_id UUID NULL REFERENCES ... ON DELETE SET NULL` runs on a table owned by the Flyway role
    (`helio` in prod; `helio_migration_test` in FlywayNonSuperuserMigrationSpec:342-345, which already covers V115).
    All existing values are NULL, so FK validation has nothing to check.
  - RI checks and referential actions run as the referenced/referencing table owner with
    `SECURITY_NOFORCE_RLS`. As a result:
    - `helio_privileged` deleting a payload correctly SET-NULLs points.
    - An app-role pipeline delete cascades through both paths.
    - D-1's "FK checks and referential actions are not RLS-filtered" is accurate.
  - V116 does no DML over FORCE-RLS tables, so the V98-style NO FORCE bracket is not needed.
  - Task 1.2 registers the table in RlsPolicyGuardSpec, RlsPrivilegedDmlSpec and FlywayNonSuperuserMigrationSpec;
    all three exist.
  - Every existing multi-table `TRUNCATE ... pipelines` in backend tests already uses `CASCADE` (4 sites grepped), so
    the new FK chain cannot break them. Task 6.10 covers anything else.
- **Privileged pool, D9 and D5.**
  - `overwriteRowsWith` is `ctx.withSystemContext(overwriteRowsAction(...).andThen(andThen))`
    (NodeSnapshotRepository.scala:113-120). `withSystemContext` is `privilegedDb.run(action.transactionally)`
    (DbContext.scala:63-64). Composing `payloadAction.flatMap(insertAction)` into `andThen` is therefore genuinely
    one transaction with the snapshot replace.
  - The tier read (`pipelines JOIN users`) runs on the BYPASSRLS pool, the same as `thinAndPurge`.
  - D5 holds for these reasons:
    - The only `outputHistoryRepo` write site is PipelineRunService.scala:1435-1452, inside `onUnblockedRunSuccess`.
    - Dry runs branch to `onDryRunSuccess` at :1185.
    - The HEL-947 backfill path (~:670-725) never references `outputHistoryRepo` (grep).
  - `nodeOutputs`, `configsById`, `runId`, `triggerSource` and `now` are all in scope as D-3 states. A `RootKey`
    always yields an explicit root id, so the V98-style CHECK in D-1 is always satisfiable.
- **Tier caps, purge and L2 thinning.**
  - `thinAndPurge` (OutputHistoryRepository.scala) uses advisory key "HEL1272" in its own transaction. The payload
    purge takes a distinct key and a separate transaction, after it.
  - Unreferenced-payload deletion keeps every payload reachable from a surviving point without deciding which point
    is "previous" (HEL-1285 untouched).
  - An unknown or zero tier fails closed, both at write and at purge.
- **D8 (public never reaches payloads).**
  - The public route calls `OutputHistoryService.forOutput` and projects through `OutputHistoryResponses.public`
    (OutputHistoryProtocol.scala:52).
  - D-7 keeps `PublicOutputHistoryPoint` unchanged, and 6.7 asserts no `id`/`hasPayload`/`payloadId`/`rows` keys.
  - `PublicDashboardRoutes` gains nothing.
- **Contract.**
  - The live authenticated requirement is preserved verbatim in the MODIFIED delta, with only point id/hasPayload
    and a new scenario added (diffed). The public requirement is also preserved, with the additions only.
  - `check:schemas` pairs each schema by `title` to a case class and fails loudly on a missing one
    (check-schema-drift.mjs:136-147). The new payload schema is therefore forced to match a response class.
  - `historyPoint` `$defs` with `additionalProperties:false` are enforced by the existing JSON-schema validation in
    OutputHistoryRoutesSpec.scala:274.
  - `create-pipeline-transactional-output-request` lives in `schemas/pipelines/`. The design's "three request
    schemas" are all present.
  - Both config validation call sites exist: OutputService:460 and PipelineService:684.
- **Production wiring.**
  - Main.scala:152/272 constructs `OutputHistoryRepository` and passes it to `ApiRoutes`, which derives one from
    `dbContext` when absent (ApiRoutes.scala:253-254) and threads it into `PipelineRunService` (:471) and
    `OutputHistoryService` (:499).
  - Main.scala:283 builds `OutputHistoryRetentionService` directly. D-8's non-defaulted retention params give a
    compile-time failure if Main omits them.
  - Test 6.9 observes a stored payload through `ApiRoutes` built from `dbContext`, which catches a dropped
    `PipelineRunService`/`OutputHistoryService` thread.
- **HEL-1282.** `check-node-root-encoding.mjs` TARGET_FILES are exactly `OutputRepository`, `NodeSnapshotRepository`
  and `BinaryRefRepository` (lines 48-51). The plan puts all new SQL in a new `NodePayloadHistoryRepository` and edits
  `OutputHistoryRepository`, neither of which is guarded. Task 6.11 runs the guard and its selftest.
- **Storage parity.** `node_snapshots.data` is already JSONB (V94:278-284), so storing payload rows as JSONB adds no
  new failure class: NUL-in-string rejection and object-key reordering already apply to the snapshot in the same
  transaction.

### Verdict: REFUTE

### Change Requests

1. **Task 3.3 contradicts design D-3 on where and when the caps are measured.** Two sources disagree:
   - tasks.md:25 says: "Wire PipelineRunService: **cap check before DB**, WARN on skip, payloadAction.flatMap(...)".
   - design.md D-3 step 2 (line 54-55) says a zero/unknown tier returns `None` "with **no serialization and no
     WARN**. Only then build and measure the array". design.md:63 says PipelineRunService passes the rows and caps
     "to `writeAction`, which measures **after the tier check**".

   The tier check is a DB read, so "before DB" and "after the tier check" cannot both hold. The two readings
   differ in observable behaviour. Under the task's reading, an opted-in free-tier node over the cap logs a
   spurious over-cap WARN and pays a full serialization on every run for a tier that can never store anything.
   That is exactly what D-3 step 2 promises will not happen. Nothing in 6.1/6.2 would catch the divergence, so it
   would surface only at the final gate as a design divergence.

   Required revision:
   - (a) Rewrite task 3.3 to match D-3. PipelineRunService only decides "some Output on this node opted in" and hands
     the rows and caps to `writeAction`. `writeAction` reads the tier first, and only for a payload-allowing tier
     checks the row count (cheap, before building the string), then the compact-JSON byte size, WARNing and
     returning `None` when over either cap.
   - (b) Add to 6.1 (or 6.2) an assertion that a free-tier opted-in node over the row/byte cap logs **no** over-cap
     WARN. Without it the D-3 step 2 ordering is an untested claim.

### Non-blocking notes

- **Validate the payload response body against its schema.** Task 6.6 should run
  `JsonSchemaValidation.compile("outputs/output-history-payload-response.schema.json")` on the 200 body, the same
  pattern as OutputHistoryRoutesSpec.scala:274. `check:schemas` compares only top-level property names. It cannot
  catch the schema's "all required, none omitted" promise for `runId: null`, which spray-json's default writers
  would drop.
- **Residual deadlock surface is not actually disclosed in design.md.** Round 3 said "the design acknowledges it",
  but the only "deadlock" mention is the trim's "deadlock avoidance" (design.md:59). Here is the surface:
  - The one-row trim's `ON DELETE SET NULL` updates a node's points.
  - The concurrent `thinAndPurge` multi-row DELETE can lock the same points in a different order.
  - A deadlock victim on the run side fails the node, and therefore the run (D9).
  - The window is tiny and D9 makes this owner-accepted shape.

  Add one line under Risks and in the PR body.
- **Row-count check first.** Inside `writeAction`, compare `rows.size` to the row cap before building the compact
  string, so a large node over the row cap is never serialized just to be discarded. This is folded into CR 1(a)
  but worth stating.
- Gate-defect check (CON-160): not applicable. No evidence directories or mtime-ordering claims were involved.
