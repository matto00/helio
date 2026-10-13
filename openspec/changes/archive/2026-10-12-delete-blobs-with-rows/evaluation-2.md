## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `b84dc7a61730a6c036195667b8f0ea876a5fb0cb` against the live-resolved base `7359a676ad3d705cd13779647681fe35a7bbd836`. The cycle-2 delta is `b4819c006..b84dc7a61`.

### Phase 1: Spec Review — FAIL

Cycle-1 change requests:
1. G2 guard: **resolved.** `WorkspaceTeardownServiceSpec` "G2 [guard] remove the stored object of a tagged csv source" creates a csv through the real service, checks that the file exists, and runs `teardown`. It then asserts the row is gone and the file is gone. It is labelled as a guard, green before and after the change, which is correct for G2.
2. Spec delta: **resolved, with one exception.** The new requirement "A refused form submit removes the form files it stored" covers the refused-append case, which `FormSubmitRoutesSpec` tests. The zero-row scenario is also added. The exception is the "Append future fails" scenario; see the issue below.

Issue:
1. **Untested SHALL: "When the append future itself fails, the objects SHALL be left in place"** (`specs/stored-object-lifecycle/spec.md`, the new requirement and its scenario "Append future fails").

   You asked me to decide on this; the decision is to add a test. The scenario cannot stay as an untested SHALL. Rewording it as a known gap would also weaken a real safety property. That property is that we never delete the objects of a row that may have committed, and a later "fix the leak" refactor that compensates failed futures would quietly break it.

   The executor's reason for skipping the test ("no fault hook") does not hold. The spec already has the `afterWrite` hook (`FormSubmitRoutesSpec.scala:87/92`), and it can force a failed append future without any production change:
   - Make the hook run `UPDATE data_sources SET dataset_schema = '{"x":1}'::jsonb WHERE id = <src>`. That is valid JSONB but the wrong shape.
   - Phase 1's `getDeclaredSchema` has already run before the hook.
   - The in-lock `appendBuiltRowAction` (`DataSourceRepository.scala:647-651`) then throws in `convertTo[Vector[DatasetFieldDeclaration]]`. The transaction rolls back and the future fails.

### Phase 2: Code Review — PASS

Gate evidence (my own run). From the worktree's `backend/`, with no sbt server:

```
nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly <the same 20 suites as cycle 1>"
```

Result: `Suites: completed 20, aborted 0`, `Tests: succeeded 565, failed 0`, `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`. The project-definition line names this worktree. That is the cycle-1 count of 563 plus the two new tests, G2 and the zero-row delete.
Log: `/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval2-tests.log`.
I did not run a full `sbt testFull` (the driver's machine-wide cap).

Cycle-1 change requests:
- `StoredObjectDeletionServiceSpec.scala` now has `import java.sql.Timestamp`; lines 183-187 use `Timestamp.from`. **Resolved.**
- `FormSubmitRoutesSpec.scala` now has `import scala.collection.mutable.ArrayBuffer`; lines 83 and 86 use `ArrayBuffer.empty`. **Resolved.**
- The `setClause` parameter is removed and `queuedRow()` takes no arguments. **Resolved.**
- A grep of the cycle-2 diff finds no remaining inline FQNs.

New code:
- `DataSourceService.scala:709` is now `flatMap(deleted => if (deleted) deleteBackingObject(source) else Future.unit)`. This is correct. The audit still records the delete and the API still returns `Right(())` for a zero-row delete, which is unchanged behaviour.
- The new "keep the file when the row delete removed no row" test uses a repository stub that returns `false`.
  - Its red was not shown. No executor log demonstrates it, and I did not re-run it against the cycle-1 code.
  - On the cycle-1 code, `flatMap(_ => deleteBackingObject(source))` deleted the file unconditionally, so `files() should contain(path)` fails there. I accept the red by reading the code. The test is not a Decision 6 label.

### Phase 3: UI Review — N/A

No trigger path changed. The cycle-1 live check (`/home/matt/Development/helio/.concertino/runs/HEL-1434/evidence/.concertino-eval1-live.log`) still holds: cycle 2 changed only the zero-row branch of `DataSourceService.delete`, which the live flow did not touch.

### Overall: FAIL

### Change Requests
1. Add a test to `FormSubmitRoutesSpec` for the spec's "Append future fails" scenario:
   - Seed a file-field form panel. Set `afterWrite` to run `UPDATE data_sources SET dataset_schema = '{"x":1}'::jsonb WHERE id = $src`. Submit the multipart request.
   - Assert the request does not succeed (a 5xx) and that no `dataset_rows` row exists for `src`.
   - Assert that the one written `form-uploads/` key is NOT in `deletedPaths`.
   - Show it red under a mutation: in `PanelFormFileSubmission.scala`, compensate failed futures too, for example with a `.recoverWith` that calls `removeStored` and then re-fails. Save that log next to the others.
   - Reword the requirement sentence and the scenario as "SHALL NOT remove the stored objects (the append may have committed)", so the requirement states the safety property rather than the leak.

### Non-blocking Suggestions
- `origin/main` has moved by one commit: #980, HEL-1457, which adds `V127__dashboard_layout_version.sql`. V128 is still free on main and `git merge-tree HEAD origin/main` is clean. Merge origin/main before delivery and re-run `StoredObjectDeletionsMigrationSpec` and `V119OwnerFkMigrationSpec`: the V128 template migrates to V126, so V127 then runs during the migrate step under the owner role. The cycle-1 merge-order concern is gone now that #980 has landed first.
