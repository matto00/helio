## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD a256261dcc3990c5b35aca9eec6707aa0408db52 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-dashboard-service/hel-1234`.
- **Premise:** `wc -l DashboardService.scala` gives 473, matching the proposal's figure (the ticket says 431). The pure `plan` lives in `DashboardLayoutRepair.scala`, which is 74 lines. Cited call sites are correct: `ApiRoutes.scala:357` has 4 positional args, and `DashboardProposalService.scala:133,139` calls `deleteInternal`.
- **D3 seams vs the guards:** I read `ExistenceNotLeakedRoutesSpec.scala` lines 316-337 and 480-492. `filesCallingAccessHelpers` and `forbiddenProducerCounts` key on file name and check non-comment lines. The current helper and Forbidden sites are `requireAccess(` at 215 and 357, and `Forbidden()` at 156, 176, 217, 308 and 359. Every one of them falls outside the blocks D3 moves. Those blocks are `insertNew` (112-127), `applyUpdate` and `writeUpdate` (230-292), the repair tail (310-337), the import body (372-391) and `validateImportPanels` (393-449). None of them contains a helper call or a `Forbidden(`. The seams can therefore move with no pin edit. No `DashboardWrites*`, `DashboardLayoutRepairWrite*` or `DashboardSnapshotImport*` file exists anywhere under `backend/src`, so the filename-keyed maps cannot collide.
- **Name resolution:** `DashboardServiceValidation.validateSnapshotPayload` is public (line 17), and the companion forwarder at lines 471-472 only calls it. `repairImportedLayoutGeometry`, `validateDashboardLayoutPayload` and `validateDashboardUpdateRequest` are `private[services]` in that object, so a module in the same package that imports `DashboardServiceValidation._` resolves them the same way. Scala is 2.13.15 (`build.sbt:4`). Today the inner `import DashboardService._` shadows the file-level wildcard. In the module only the file-level import exists, and both point to the same target function. The D3 note is correct.
- **Evaluation order and audit:** each moved call runs at the same point. `insertNew` runs in the `create` branches, `applyUpdate` in the two `update` cases, and the repair tail inside the `Some(existing)` callback. The `validateSnapshotPayload` match still runs synchronously when `importSnapshot` is called. Both moved `audit(...)` calls (lines 324-329 and 382-387) pass all four args explicitly, so the function-value type `(String, Option[String], AuthenticatedUser, JsValue) => Unit` (D5) works with no change to call text.
- **300-line target:** counted from the file, the moves remove about 17, 64, 27, 19 and 58 lines. Unused imports remove about 4 more (lines 8, 10, 17, 18). Module wiring adds about 4. That gives roughly 288 lines, so the target is reachable with about 12 lines to spare. The D8 fallback is properly specified (record the measured floor and why each block stays, still < 400, no ACL moves). Each new file comes to about 100-110 lines, under 250.
- **No test relies on these private members:** `grep` for `PrivateMethod|validateImportPanels|applyUpdate|writeUpdate|insertNew|getDeclaredMethod` under `backend/src/test` finds only one comment, at `ApiRoutesSpec.scala:1549`. `ExistenceNotLeakedRoutesSpec` is the only test that names `DashboardService.scala`.
- **D7a can fail:** the MATCH script copies the HEL-1253 `move-match.py` (present in the archive) and has a red run on a scratch copy with one token changed. D7b and D7c can also fail.
- **D1/D7d javap criterion — wrong as written.** I ran `javap -public com.helio.services.dashboards.DashboardService` on the compiled class from the sibling worktree hel-1371, built at the same source. It lists about 45 `public static final` synthetic lambda members, for example `$anonfun$applyUpdate$1`, `$anonfun$writeUpdate$1..7`, `$anonfun$repairLayout$1..6`, `$anonfun$importSnapshot$1,2`, `$anonfun$validateImportPanels$1..5` and `$anonfun$repairLayout$3$adapted`. Moving those bodies necessarily removes these members and renumbers others. A raw `javap -public` diff will therefore always be non-empty, so the "empty diff" criterion in ticket.md's AC, D1 and D7d can never pass. The HEL-1253 precedent never used javap, so it does not cover this.

### Verdict: REFUTE

### Change Requests

1. **Make the javap evidence achievable without changing what it proves.** Edit ticket.md (AC, third bullet), design.md D1 and D7(d), and tasks 1.2 and 3.2:
   - Specify the exact comparison. Run `javap -public` on `DashboardService`, `DashboardService$`, `DashboardService$CreateDashboardInput` and `DashboardService$CreateDashboardInput$` at base and at head. Filter out the compiler-synthetic lambda members (lines matching `\$anonfun\$`, including the `$adapted` variants), then diff. The required result is that the filtered diff is empty.
   - Record the unfiltered diff as well, showing it contains only `$anonfun$` lines. That shows the filter hid nothing else.
   - State that the module fields on `DashboardService` must be `private val`. Any other modifier adds a public accessor, which the filtered diff must flag as red.
   - State how the base classfiles are produced: compile the unmodified tree in task 1.2 and save the `javap` output to scratch before any edit.

   As written, the executor will hit an unavoidable red at 3.2 and either break D1 or weaken the check on the fly. The filter has to be decided at this gate, not during execution.

### Non-blocking notes

- In D3, the module constructors need `(implicit ec: ExecutionContext)` for their `flatMap` and `map` calls. Name it and pass the service's own `ec`. The compiler will catch an omission, but stating it keeps "constructed from its own constructor params" unambiguous.
- If the moved repair-tail method takes `existing` as a parameter, keep the name `existing` so the body stays verbatim. The same applies to `patchPayload`, `dashboardId` and `user`.
- The class scaladoc still says "this service's own mutation paths above" (line 70). That is fine, because `findById` does not move.
- D7(e): `check-scala-quality.mjs` applies a 250-line soft budget (line 70). `DashboardService.scala` at about 288 will raise a soft warning. That is expected and is not a failure.
