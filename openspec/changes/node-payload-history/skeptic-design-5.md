## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed cold against the live tree at HEAD d9473814f16df0c54ef76117c00ce9c071297b2b, which is also origin/main.
The change dir is untracked planning artifacts only, with no code diff. Inputs I treated as settled: owner
rulings Q1 `1mib-skip` and Q2 `output-config` (I confirmed both in `.concertino/runs/HEL-1276/events.jsonl`,
lines 4-5, `escalation.answered` with `answer_source: human`) and epic rulings D1-D10. HEL-1285 is not settled
here.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/opt-in-payload-history/HEL-1276`.
- **V116 is free everywhere I can see.**
  - The main tree's latest migration is `V115__output_snapshot_history.sql`.
  - No remote branch has a V116 (I iterated `git ls-tree` across every `origin/*` ref).
  - No open PR adds one.
  - A read-only query of the shared dev DB's `flyway_schema_history` shows its newest version is `115`.
- **Prior-round CRs are closed in the artifacts.**
  - R3, public-path status: spec scenario "Public payload path does not exist" and task 6.7 now say 401 through
    full `ApiRoutes`, plus `handled shouldBe false` on `PublicDashboardRoutes` alone. This matches the live
    composition. `PublicDashboardRoutes.scala:412-413` uses `pathPrefix(Segment / "history") { pathEndOrSingleSlash`,
    so `/history/<id>/rows` is rejected there. `ApiRoutes.scala:872-883` then falls through to
    `authDirectives.authenticate`.
  - R4, cap ordering: task 3.3 now matches D-3 step 2 (tier first, then row count, then compact-JSON bytes), and
    6.2 asserts that a free-tier node over both caps logs no over-cap WARN.
  - R4 notes: 6.6 validates the 200 body against the schema via `JsonSchemaValidation`. The residual deadlock is
    now in Risks.
- **D9 atomicity is real.**
  - `NodeSnapshotRepository.overwriteRowsWith` (lines 113-120) runs `overwriteRowsAction(...).andThen(andThen)`
    under `ctx.withSystemContext`, which is `privilegedDb.run(action.transactionally)` (DbContext.scala:63-64).
  - D-3 composes `payloadAction.flatMap(pid => insertAction(...))` as that `DBIO[Unit]`, so the signature needs no
    change.
  - `NodeSnapshotRepository.scala` is therefore not edited, so the HEL-1282 guard is not triggered.
  - `scripts/check-node-root-encoding.mjs` scans a fixed `TARGET_FILES` list of three files, and a new
    `NodePayloadHistoryRepository.scala` is outside it.
- **D5 run filter is structural.**
  - The payload is written only inside the `outputHistoryRepo` branch of `onUnblockedRunSuccess`
    (PipelineRunService.scala:1434-1452).
  - That method is reached only on the `Right(())` arm after the blocked check and `applyPendingWriteBacks`
    (lines 1281-1290).
  - Dry runs take `onDryRunSuccess` (line 1185).
  - The HEL-947 backfill uses `persistBackfilledRows` (line ~780), which calls plain `overwriteRows`.
  - `configsById` exists only when `outputHistoryRepo != null` (lines 1374-1376). The opt-in therefore depends on
    the history repo being wired, and D-8/6.9 cover that.
- **RLS and the privileged pool.**
  - V115 is the template D-1 mirrors: ENABLE+FORCE, four `helio_can_access_pipeline` policies and an explicit
    `GRANT ... TO helio_privileged`.
  - All payload reads and writes go through `withSystemContext`, as for `node_snapshots`.
  - `thinAndPurge` already joins `pipelines`/`users` on the privileged pool, so the D-3 tier read has precedent.
  - The two-role infrastructure exists: `OutputHistoryRlsSpec`, `OutputHistoryApiHarness` (`helio_app_test`),
    `RlsPolicyGuardSpec:87-88`, `RlsPrivilegedDmlSpec:143,276` and `FlywayNonSuperuserMigrationSpec:342-344`'s
    FORCE-table list. Task 1.2 registers the new table in all three.
- **FK, SET NULL and RLS.** The design says FK checks and referential actions are not RLS-filtered. That is
  correct Postgres behaviour: RI triggers run with row security not forced. In prod `helio` creates both tables
  in V116 and owns V115's table, so the `ALTER ... ADD COLUMN ... REFERENCES` needs no extra privilege. The
  double cascade into `output_snapshot_history` on pipeline delete (outputs CASCADE, V94:208; payloads CASCADE
  then SET NULL) is called out, and task 6.8 proves it.
- **Production wiring.**
  - Main.scala:152 builds `OutputHistoryRepository` and :283 builds `OutputHistoryRetentionService(repo, config, clock)`.
  - ApiRoutes:253-254 derives `outputHistoryRepoOpt` from `dbContext`, and :471 and :498-499 thread it.
  - D-8 makes the retention service's payload params non-defaulted, so a missing `Main` arg is a compile error.
  - The run and read paths use the same derive-from-`dbContext` fallback that 6.9 exercises.
  - The scheduler reuses `apiRoutes.pipelineRunService`, so scheduled runs inherit the payload path.
- **Contract reachability.**
  - D-7 adds `id` and `hasPayload` to the authenticated `OutputHistoryPointResponse` only. Today that type is
    `OutputHistoryProtocol.scala:12`; `PublicOutputHistoryPoint` is at :28 and stays as is.
  - Both new fields come from the existing `listRecent` row, so the "Bounded query count" requirement is untouched.
  - The schema files named in D-7 exist: `schemas/outputs/{create,update}-output-request`,
    `schemas/pipelines/create-pipeline-transactional-output-request` and `output-history-response`.
  - `check-schema-drift.mjs` (lines 133-160) requires every schema `title` to map to a case class, so the new
    payload response schema forces a matching protocol class (task 5.1 "with its JSON protocol"; verified by 5.3).
- **Spec deltas.** The two MODIFIED requirement headers ("Authenticated history read", "Public history read is
  allow-listed") match `openspec/specs/output-history-api/spec.md` exactly. The modified text keeps every
  original clause and scenario and adds to them.
- **Internal consistency.** Task 3.3 matches D-3, 4.1 matches D-5, 5.1 matches D-6, 5.2-5.3 match D-7, and 5.4
  matches D-8. The tier caps (0, 10/7d, 30/30d) match D4 in D-4, the spec and the proposal. Purge order
  (thin, then payload purge in the same gate) matches the retention spec's "failures never fail the tick". I
  found no task that contradicts a design decision.
- **Constraints.** No task touches `.github/workflows/ci.yml` or `playwright.config.ts`. C4 prefers
  EmbeddedPostgres.

### Verdict: CONFIRM

### Non-blocking notes (carry these into execution)

1. **Task 6.5's red mutation is wrong as written.** It says "policy dropped -> stranger sees row". With RLS
   ENABLE+FORCE and no SELECT policy, Postgres denies everything: nobody sees the row, stranger included. The
   repo's own precedent shows this. `V94OutputsMigrationSpec.scala:962-966` drops `outputs_select` and asserts
   the owner sees nothing. A literal implementation cannot go red. Use one of these instead:
   - (a) the V94 shape: drop `node_payload_history_select` and assert that the owner and the grantee now see
     zero, then restore it;
   - (b) replace the policy with `USING (true)` (or `DISABLE ROW LEVEL SECURITY`) and assert the stranger now
     sees the row.

   The normative spec scenario ("stranger sees zero, owner/grantee see the row") is correct. Only the task's
   red recipe needs fixing. The evaluator should check that the red actually flips.
2. **The payload purge uses its own advisory-lock key ("HEL1276").** It is not serialized against `thinAndPurge`
   ("HEL1272") on another Cloud Run instance. The two are multi-row deletes over overlapping
   `output_snapshot_history` rows: the payload purge's SET NULL against thin's DELETE. That is exactly what the
   HEL1272 lock comment (`OutputHistoryRepository.scala:150-151`) says can deadlock. The outcome is benign: one
   purge aborts, the error is logged, and the next interval retries. Either reuse the HEL1272 key (the two run
   as sequential transactions, so they never contend with each other in-process) or add this case to the
   Risks/PR-body line beside the run-side trim deadlock.
3. **Byte cap units.** Measure `compactPrint.getBytes(UTF_8).length`, not `String.length`. The exactly-at-cap
   case in 6.2 should use multi-byte content so it catches the difference.
4. **D-4 "minimum 1" for MAX_ROWS/MAX_BYTES.** State that 0 falls back to the default with a WARN, like
   negatives do, and cover it in the 2.1 config spec.
5. **Concurrent lane.** PR #779 (HEL-1275) is in flight on the same history response and has frontend history
   fixtures. Adding required `id`/`hasPayload` does not break TypeScript consumers. Whichever lane merges
   second should re-run any fixture-against-schema validation.
6. **D5 coverage.** 6.1 tests only dry run among the D5 exclusions. The structure guarantees the rest (see
   above). One blocked-run or write-back-failure assertion of "no payload row" would turn that structural
   argument into evidence cheaply.
7. **`OutputHistoryPoint` gains `payloadId`.** D-3 defaults only `OutputHistoryInsert.payloadId`. Either default
   the point's field too or expect to update the test constructors of `OutputHistoryPoint`. This is mechanical
   and the compiler will surface it.

Gate-defect check (CON-160): not applicable. No evidence directories or mtime-ordering claims were involved.
