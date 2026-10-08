## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD a256261dcc3990c5b35aca9eec6707aa0408db52 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/split-dashboard-service/hel-1234`.
- **Round-1 CR1 (javap) addressed, in every place it named:**
  - ticket.md, AC bullet 3: the `$anonfun$`-filtered diff must be empty, and the unfiltered diff may differ only in `$anonfun$` lines.
  - D1: names all four classes, requires `private val` module fields ("a public accessor must show up in the diff"), and says the base is captured in task 1.2 before any edit.
  - D7(d): restates the filtered and unfiltered checks.
  - Task 1.2: captures the base `javap -public` "BEFORE any edit".
  - Task 3.2: runs the diff per D7d.
  - workflow-state constraint C3: has been updated to match.
- **Is the filtered check passable? (ground truth, not the plan's claim):** I ran `javap -public` and `javap -p` on `DashboardService.class` compiled in sibling worktree hel-1371. Its `DashboardService.scala` is byte-identical to a256261dc (`git diff a256261dc HEAD -- services/dashboards/` is empty).
  - With `$anonfun$` lines removed, the public surface is the constructor, `$lessinit$greater$default$3`, static `validateSnapshotPayload`, the 9 public methods plus `update$default$4`, and `deleteInternal`.
  - The members that move (`insertNew`, `applyUpdate`, `writeUpdate`, `validateImportPanels`, `validateOne$1`, `audit`, `audit$default$4`) are all emitted `private` today, with no expanded-name (`com$helio$...$$x`) public accessors.
  - So moving them cannot change the filtered output. New `private val` module fields compile to private fields and accessors, and the eta-expanded `audit` becomes a `$anonfun$` member, which the filter removes.
  - So the filtered check can pass. It can also fail: a `val`, a changed signature or a dropped default would each show up.
- **Can the check fail? Yes:** a non-`private` module field would emit a public accessor that the filter does not remove.
- **Line budget:** I recounted from the source. The blocks removed are 112-128 (`insertNew` plus a blank line), 230-293 (`applyUpdate`/`writeUpdate`), the repair tail at 310-337 (replaced by a 1-line call), the import body at 372-391 (replaced by a 1-line delegate) and 393-449 (`validateImportPanels`). Together that is about 185 lines. About 4 imports become unused (lines 8, 10, 17, 18), and about 4 lines of module wiring are added. That leaves about 288 lines, which is <= 300. The D8 fallback is specified for the case where it comes in over.
- **Guards:** I re-read the source. `requireAccess(` is at 215 and 357, and `ServiceError.Forbidden()` is at 156, 176, 217, 308 and 359. None of these lines is inside a block D3 moves. D2 also forbids passing `accessChecker` to any module.
  - I grepped the tests for other source-scanning guards that key on this file or package. Only `ExistenceNotLeakedRoutesSpec` matches.
  - `AuditMutationInstrumentationSpec` and `DashboardLayoutRepairSeamSpec` are behavioural, route-level tests, so they keep exercising the moved audit/repair paths.
- **Precedent consistency:** HEL-1253 `PanelService.scala:73-84` wires its modules as `private val` and passes `audit` as `(String, Option[String], AuthenticatedUser, JsValue) => Unit` (`PanelBatchWrites.scala:23`). D3 and D5 copy that pattern. The archived `move-match.py` exists for D7(a).
- **Order and initialization:** The modules are built after the `require`, and the eta-expanded `audit` does not dereference the nullable `auditService` at construction. The `importSnapshot` delegate keeps the synchronous `validateSnapshotPayload` match at call time. The repair tail stays inside the `Some(existing)` callback. All three are stated in D3, D5 and D6. The `validateSnapshotPayload` resolution change (the companion forwarder becomes its target) is disclosed in D3 and is the same function.
- **Placeholders/contradictions:** I found no TBD or deferred decisions. Tasks map 1:1 to D3 and D7.

### Verdict: CONFIRM

### Non-blocking notes

- ticket.md AC lists only `DashboardService`/`DashboardService$` for javap, while D1 lists four classes (adding `CreateDashboardInput` and its companion). D1 is the stricter of the two. Follow D1.
- Let `move-evidence.md` show the base `javap -p` private-member list next to the public one. That proves the moved methods were private, not public under a mangled name, so the filter could not hide them.
- `check-scala-quality.mjs`'s 250-line soft budget will warn on a ~288-line `DashboardService.scala`. Expected; not a failure (carried from round 1).
