## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `221f263ba12b22b55df029b0f0374f52a66a5d98`. It is the merge of origin/main `968835477` (#980, HEL-1457, which brings V127) into `8ecb58815`.

The live-resolved base is `968835477e67901a21c5d9fd8d22f7918a6558c3`. The diff against it is exactly the 33 HEL-1434 files: the merge introduced no conflict-resolution edits outside this change.

### Phase 1: Spec Review — PASS

Cycle-2 change request: **resolved.**
- `FormSubmitRoutesSpec` has the new test "leave the stored objects in place when the in-lock append future fails (HEL-1434)". Its `afterWrite` hook sets `dataset_schema = '{"x":1}'::jsonb` after phase 1 has run.
- It asserts that the request does not succeed, exactly one `form-uploads/` key was written, that key is not in `deletedPaths`, and there are 0 `dataset_rows` for the source.
- The spec delta now reads "the system SHALL NOT remove the stored objects (the append may have committed)", in both the requirement and its scenario.

Every acceptance criterion, task and Decision 6 label is still covered:
- R1-R6, M1-M5 (with M4.i and M4.ii), G1-G5 and W1.
- The refused and failed form-append cases.
- The zero-row delete.

Migrations and constraints:
- V127 (from main) and V128 (this change) are now contiguous, so there is no gap and no ordering hazard.
- Workflow CONSTRAINTS C1-C6 are still honoured. C3's temp-root reading is as noted in evaluation-1.

### Phase 2: Code Review — PASS

Gate evidence (my own run, on the MERGED tree). From the worktree's `backend/`, with no sbt server, I ran the 20 affected suites:

```
nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly …"
```

They include `StoredObjectDeletionsMigrationSpec`, `V119OwnerFkMigrationSpec` and `RlsPolicyGuardSpec`; V127 runs in the migration specs' migrate step under the owner role.

Result: `Suites: completed 20, aborted 0`, `Tests: succeeded 566, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. The project-definition line names this worktree.
Log: `/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval3-tests.log`.
I did not run a full `sbt testFull` (the driver's machine-wide cap); CI runs it on the PR.

Mutation red, verified independently:
- **Setup.** In a throwaway detached worktree at `221f263ba` (under the gitignored `backend/target/`), I made `PanelFormFileSubmission` also compensate failed futures:

  ```scala
  }.recoverWith { case ex => removeStored(refsByField.values).flatMap(_ => Future.failed(ex)) }
  ```

- **Result.** `testOnly *FormSubmitRoutesSpec` fails exactly the new test, at `FormSubmitRoutesSpec.scala:562` (`deletedPaths ... contained element "form-uploads/…"`): 30 succeeded, 1 failed, and `[hel1468-guard]` reported failed=1.
- **What the test exercises.** The test is green unmutated, and only a failure-path mutation turns it red. So it exercises the failed-future path, not a refused `Left`: the `Left` path compensates and would already be red on the unmutated code.
- **Cleanup.** The scratch worktree is removed (`git worktree remove --force`), its sbt server shut down, and `git worktree list` is clean.
- **Evidence.** Log, with the mutation diff appended: `/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval3-mutation.log`.

This matches the executor's `mutation-formfile-failed-future-cycle3.log`: same assertion, same line.

Code quality: there are no new inline FQNs in the HEL-1434 Scala diff. The new test follows the existing `afterWrite` probe shape and its comment explains why the fixture is shaped that way. No production code changed this cycle.

### Phase 3: UI Review — N/A

No trigger path changed: no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**`.

The cycle-1 live check still applies: a throwaway `@example.test` user, a `DELETE FROM users`, and both objects drained within one poll. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval1-live.log`. Since then the only production change was the zero-row branch of `DataSourceService.delete`, which that flow does not take.

### Overall: PASS

### Non-blocking Suggestions
- Decision 4 asks for a follow-up ticket so the owner runs the prod read-only measurement (measurements.md 1.3). No ticket id appears in the change yet; file it at delivery.
- The PR body should carry the planned OWNER REVIEW section. Once deployed, prod objects of rows deleted from then on are removed automatically, including by an owner's manual `DELETE FROM users`.
- The shared dev DB is at V127. A backend started from this branch (or from main after merge) will apply V128 to it. That is expected, and harmless to the other worktrees: Flyway ignores a V128 they do not have.
