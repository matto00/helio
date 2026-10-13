## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `b4819c006dc4c6cb8374444b516599174440d0e5` against the live-resolved base `7359a676ad3d705cd13779647681fe35a7bbd836` (origin/main).

### Phase 1: Spec Review — FAIL

Passing:
- AC1 (inventory): design.md has the delete-path table. AC2 (decide and implement): a trigger-fed queue, drained on the tick. AC3 (read-only measurement plus the prod procedure): measurements.md. I re-ran the dev measurement read-only and got identical numbers: 76 objects, 31 orphans, 3 missing. So no historic orphan was deleted.
- V128 is still free. No origin branch and no local worktree has V128. V127 exists only on `bug/layout-write-concurrency-precondition/HEL-1457` (#980). The shared dev DB is still at V127, so this lane never applied V128 there.
- Workflow CONSTRAINTS:
  - C1: the red logs are behavioural, not compile failures. `[hel1468-guard]` was present in my run.
  - C2 and C6: M4 runs as a NOSUPERUSER NOBYPASSRLS owner role. The posture is SECURITY DEFINER, pinned search_path, `row_security=off` and owner `helio_privileged`. The queue has FORCE RLS and no policy.
  - C4: honoured, see the live check.
  - C3 and C5: see the issues below.
- Every task is ticked and matches the diff. No scope creep: the PanelFormFileSubmission fix falls under Decision 5's conditional. No API or `schemas/` change.

Issues:
1. **G2 guard missing.** Decision 6 lists "[GUARD] G2 Workspace teardown still removes the object". No spec carries a G2 label, and no existing spec asserts it: `WorkspaceTeardownServiceSpec` builds a `LocalFileSystem` (line 147) but never checks that a file is gone. C1 requires every Decision 6 label to be delivered.
2. **Spec delta out of date.** `specs/stored-object-lifecycle/spec.md` has no requirement for the PanelFormFileSubmission behaviour that shipped: a refused in-lock append removes the stored form objects, and a failed append future is deliberately not compensated. The artifacts do not fully reflect the final behaviour.

### Phase 2: Code Review — FAIL

Gate evidence (my own run). From the worktree's `backend/`, with no sbt server:

```
nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly <20 suites>"
```

The 20 suites were:
- the 4 new specs
- FormSubmitRoutesSpec, RlsPolicyGuardSpec
- AssistantConversationService/RoutesSpec
- PipelineSchedulerService DetachedRetention/MaintenanceHooks
- UploadRoutesSpec, DataSourceServiceSpec, DataSourceRoutesSpec, DataSourceCreateFailureCleanupSpec, DataSourceDeleteAutoConnectorSpec
- WorkspaceTeardownServiceSpec, RlsOwnerTablesSpec
- DataSourceReferenceGuardNonSuperuserSpec, V100ZeroRootGuardNonSuperuserSpec, V119OwnerFkMigrationSpec

Result: `Suites: completed 20, aborted 0`, `Tests: succeeded 563, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. The project-definition line names this worktree. Every label ran green: R4-R6, G1, G3, G4, G5, M1-M5, M4(a)/(b), R1-R3 local plus the GCS double.
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval1-tests.log`.
I did not run a full `sbt testFull`: the driver's machine-wide cap is two full runs across four lanes, and targeted testOnly was preferred. `npm run check:scala-quality` reports clean, with soft warnings only.

Executor logs I checked against my own reading:
- Red (R1-R3 left objects present; R4-R6 failed on behaviour; the form-submit probe was red).
- Mutations M1, M2, M3, M4.i, M4.ii, M5, G4, G5, R3 and W1.
- M4.i: dropping SECURITY DEFINER aborts BOTH (a) and (b) with "query would be affected by row-level security policy for table stored_object_deletions". So (b) was recorded rather than assumed.

What checks out:
- **V128 under a NOSUPERUSER NOBYPASSRLS owner.** It uses the same transient GRANT CREATE / ALTER FUNCTION OWNER TO helio_privileged / REVOKE bracket as V100 and V122. It grants helio_privileged DML on the queue, the sequence, and SELECT on both source tables. The triggers are ENABLE ALWAYS (`tgenabled 'A'` is pinned by the spec). M4 proves the outer delete commits for both an RLS-bound session and a cascade with the GUC unset.
- **Drain detachment.** `PipelineSchedulerService.scala:145-153` starts `Future.delegate(runPass()).recover` and does not add it to the tick's zip. `StoredObjectDeletionService.runPass` has an `AtomicBoolean` in-flight guard, never fails, and resets the guard in `andThen`. The claim has a 300 s lease, `FOR UPDATE SKIP LOCKED`, an attempt cap of 10, and backoff of `LEAST(3600, 60*2^(attempts-1))` from `last_attempt_at`. `recordFailure` clears the lease.
- **Wiring.** Main.scala:293-311 builds the service over the same `fileSystem` and passes it to the scheduler. The W1 mutation turned R1-R3 red.
- **PanelFormFileSubmission is correct.** Every `Left` from `appendFormRow` comes from paths that insert nothing:
  - `findByIdOwned` returns None;
  - `appendBuiltRowAction` returns None, `FieldErrors` or `RowLimitExceeded`, each decided before `insertAppendedRowsAction`;
  - the source is not a dataset.

  So deleting the freshly UUID-keyed `form-uploads/` objects on `Left` is safe. Not compensating a failed future is also sound. The `Right` branch runs `triggerAutoRunAwaited` AFTER the insert committed, so a failed future can mean the row exists. Deleting its objects then would corrupt a committed row, and a leak is the safe side.
- **Ordering.** `DataSourceService.delete` now runs the row delete first and the object delete second (R4). The upload and assistant creates compensate and re-raise the original failure (R5, R6).

Issues (mechanical; C5 is binding):
1. Inline FQNs (CONTRIBUTING.md "Imports & Qualifiers", constraint C5):
   - `backend/src/test/scala/com/helio/services/sources/StoredObjectDeletionServiceSpec.scala:182`, `:183`, `:184`, `:185`, `:186`: `java.sql.Timestamp.from(...)`.
   - `backend/src/test/scala/com/helio/api/routes/panels/FormSubmitRoutesSpec.scala:85`: `scala.collection.mutable.ArrayBuffer` (new line).

   `check:scala-quality` does not catch either.
2. Dead code: `StoredObjectDeletionServiceSpec.scala:175` declares `queuedRow(setClause: DBIO[Int] => DBIO[Int] = identity)`, and `setClause` is never used.

### Phase 3: UI Review — N/A

None of the triggers match: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

The orchestrator asked for a live check, so I ran one:
- **Setup.** The worktree backend ran on 9773 against a **throwaway database** `helio_hel1434_eval1`, which the backend migrated to V128 itself. The shared dev DB carries V127 from HEL-1457, which is not in this tree, so Flyway would refuse it with "applied migration not resolved locally". I did not touch the shared DB. Uploads went to a temp root inside the worktree (`backend/target/eval1-uploads`), with `SCHEDULER_TICK_INTERVAL_SECONDS=10`.
- **User.** I registered `eval-hel1434-1791862843@example.test`, id `ba5e72b8-7c7a-401f-9706-d54a79ae01ec`, and confirmed it via `/api/auth/me`.
- **Objects.** I created an image upload and a csv source, and both objects appeared on disk.
- **Delete.** `DELETE FROM users WHERE id='ba5e72b8-…'` queued both keys.
- **Result.** By the first poll 30 s later, the queue held 0 rows and both objects were gone.
- **Teardown.** I stopped the servers with `stop-servers.sh` and ran `sbt shutdown`. I dropped the throwaway DB, which also removed the user, deleted the temp root, and left the worktree clean.

Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval1-live.log`.

### Overall: FAIL

### Change Requests
1. Add the G2 [GUARD] spec. Workspace teardown of a tagged csv (or text/pdf/image) source should remove its object from a temp-root `LocalFileSystem`. Assert the file is gone after `WorkspaceTeardownService.teardown`, label it `G2 [guard]`, and run it green.
2. `StoredObjectDeletionServiceSpec.scala:182-186`: add `import java.sql.Timestamp` at the top and replace the five `java.sql.Timestamp.from(` with `Timestamp.from(`.
3. `FormSubmitRoutesSpec.scala:85`: import `scala.collection.mutable.ArrayBuffer` and use `ArrayBuffer.empty[String]`. Do the same on the pre-existing line 82 so the file stays consistent.
4. `StoredObjectDeletionServiceSpec.scala:175`: remove the unused `setClause` parameter, so it reads `def queuedRow(): String`.
5. `openspec/changes/delete-blobs-with-rows/specs/stored-object-lifecycle/spec.md`: add a requirement with scenarios for the form-file path:
   - a refused in-lock append (no row written) removes the stored `form-uploads/` objects;
   - a failed append future leaves them in place, because the row may have committed.

### Non-blocking Suggestions
- `DataSourceService.scala:709` ignores the Boolean from `dataSourceRepo.delete`, so a 0-row delete still removes the file. It is unreachable today, because `findByIdOwned` and the owner-only RLS policy rule it out, and it is not a regression. `flatMap(deleted => if (deleted) deleteBackingObject(source) else Future.unit)` would make the "removed only once the row delete succeeded" comment literally true.
- The eager delete in `DataSourceService.delete` has no shared-key check, unlike the drain. This is pre-existing behaviour and is worth a known-gap line.
- **Migration merge order with HEL-1457 (#980, V127).** Main runs Flyway with defaults (no outOfOrder). If this PR merges first, #980 must renumber its migration to V129 before merging; otherwise prod boot fails validate with "resolved migration not applied: 127". The shared dev DB already has V127 applied, so this worktree's backend cannot boot against it until V127 is on main. Put both points in the PR body.
- **C3 wording.** The new specs use the repo-mandated `TempDirectorySupport`: java tmpdir, deleted in `afterAll`, enforced by `check-test-temp-dir-hygiene.mjs`. That is not a temp root inside the worktree. The intent (never `~/.helio/uploads`) is met. The orchestrator may want to record this reading of C3.
- Decision 4 says to file a follow-up for the owner's prod measurement. No ticket id appears in the change yet; file it at delivery.
