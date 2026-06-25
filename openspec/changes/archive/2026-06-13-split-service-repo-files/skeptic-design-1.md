## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

**1. Actual line counts (ground truth)**
Ran `wc -l` on the 4 files in the worktree:
- `DashboardRepository.scala` — 384L (design claims 384L — matches)
- `PanelRepository.scala` — 361L (design claims 361L — matches)
- `DashboardService.scala` — 332L (design claims 332L — matches)
- `PanelService.scala` — 347L (design claims 347L — matches)

**2. Companion object content (DashboardRepository)**
Read `DashboardRepository.scala` in full. The companion (`object DashboardRepository`) contains: `instantColumnType`, `jsonbStringType`, `DashboardRow` case class, `DashboardTable` class. Design D1 accurately describes this content. Lines 347–384 (38L).

**3. Companion object content (PanelRepository)**
Read `PanelRepository.scala` in full. The companion (`object PanelRepository`) contains: `instantColumnType`, `jsonbStringType`, `PanelRow` case class, `PanelTable` class. Lines 306–361 (56L). Design claim of "~38L" is slightly low (actual is 56L) but direction is correct.

**4. DashboardRepository snapshot op sizes**
Checked actual line ranges via `grep -n`:
- `duplicate` starts at line 174
- `exportSnapshot` starts at line 222 (delta = 48L)
- `importSnapshot` starts at line 275 (delta = 53L)
- companion at line 347 (delta = 72L)
Design claim of ~165L for the three ops is accurate; companion at ~38L is slightly undercounted.

**5. PanelRepository operation sizes**
- `duplicate` starts at line 165
- `batchUpdate` starts at line 245 (delta = 80L)
- `PipeOps` helper at line 300 (delta = 55L)
- companion at line 306 (delta = 56L)

**6. Cross-file type references — qualified names**
Ran `grep -rn "PanelRepository\.PanelRow\|PanelRepository\.PanelTable"` across all source files. Result:
- `PanelRowMapper.scala` uses `PanelRepository.PanelRow` as qualified type in 10 method signatures and constructor calls (lines 21, 51, 52, 86, 92, 98, 104, 107, 110, 116)
- `DashboardRepository.scala` uses `PanelRepository.PanelRow` as qualified type in 3 places (lines 23, 204, 335) and `PanelRepository.PanelTable` in 3 places (lines 175, 223, 276)
- `PanelRepository.scala` uses `DashboardRepository.DashboardTable` as qualified type (line 19)

**7. What the tasks say about these references**
Task 1.3: "update `import DashboardRepository._` usages" — the only `import DashboardRepository._` is inside `DashboardRepository.scala` itself (line 17). Task 1.4: "update `import PanelRepository._` usages" — the only `import PanelRepository._` is inside `PanelRepository.scala` itself (line 16). Neither task mentions updating `PanelRowMapper.scala` or the cross-references in `DashboardRepository.scala`.

**8. Visibility scope of "private" helpers in service companions**
In `DashboardService` companion (lines 296–331): `normalizeAppearance`, `validateDashboardLayoutPayload`, `validateDashboardLayoutItems` are declared `private` — accessible only within that companion/class pair. Task 3.1 moves them to `object DashboardServiceValidation`. Once in a separate top-level object, `private` means private to `DashboardServiceValidation` — `DashboardService` can no longer call them without the visibility being widened to at least `private[services]`. The tasks say "verify `private[services]` access" but do not specify that these `private` (not `private[services]`) methods must be widened. The widening is implicit, undocumented.

In `PanelService` companion: `validatePanelTypeOpt` is `private` (line 342). Task 3.3 extracts it to `PanelServiceHelpers`. Same widening issue applies.

**9. Tests that reference `DashboardService.validateSnapshotPayload` directly**
`DashboardSnapshotValidationSpec.scala` calls `DashboardService.validateSnapshotPayload(...)` at lines 40, 50, 60, 72, 84. Task 3.2 says "DashboardService companion delegates to DashboardServiceValidation" — keeping `DashboardService.validateSnapshotPayload` as a forwarding method preserves these test calls. This is unambiguous and correct.

**10. DashboardSnapshotRepository constructor shape (design D2)**
Design D2 states: "DashboardSnapshotRepository(ctx, table, panelTable)(ec) that takes shared table references." However, looking at the actual `duplicate`, `exportSnapshot`, and `importSnapshot` methods, each creates a local `val panelTable = TableQuery[PanelRepository.PanelTable]` independently. If `PanelTable` moves to `PanelTables`, those local `TableQuery[PanelRepository.PanelTable]` constructors break unless task 1.4's forwarder approach uses type aliases. The design does not specify whether the forwarder uses type aliases or re-exports.

**11. Implicit scope claim (design D1)**
Design says: "Implicits remain importable via the same package wildcard." This is true for `import com.helio.infrastructure._` or `import com.helio.infrastructure.PanelTables._` calls. However, the three snapshot methods in `DashboardRepository` reference `PanelRepository.PanelTable` as a **qualified name**, not via import. Slick's `TableQuery[T]` needs `T` to resolve as a type; if `object PanelRepository` has no type member `PanelTable` after the companion body is removed, those `TableQuery[PanelRepository.PanelTable]` calls become compile errors. The package wildcard implicit argument does not rescue qualified type references.

### Verdict: REFUTE

### Change Requests

1. **Tasks 1.3 and 1.4 must specify the forwarder pattern precisely.** The tasks say "keep `object PanelRepository` as an empty forwarder or remove it" but leave unresolved whether to use type aliases (`type PanelRow = PanelTables.PanelRow`) inside the forwarder companion. Without type aliases, `PanelRowMapper.scala` (10 references to `PanelRepository.PanelRow`) and `DashboardRepository.scala` (3 references to `PanelRepository.PanelRow`, 3 to `PanelRepository.PanelTable`) become compile errors. Either: (a) specify the forwarder companion uses type aliases to re-export `PanelRow` and `PanelTable` from `PanelTables`, OR (b) list `PanelRowMapper.scala` and the affected lines of `DashboardRepository.scala` as explicit update targets. Leaving it "or remove it" with no resolution for external callers is implementation-blocking ambiguity.

2. **Task 1.4 omits `PanelRowMapper.scala` from the update scope.** `PanelRowMapper.scala` has 10 qualified references to `PanelRepository.PanelRow` in method signatures and constructor calls (lines 21, 51, 52, 86, 92, 98, 104, 107, 110, 116). These are not import-based — they are type annotations and constructor invocations. They will not compile after `PanelRow` moves unless the forwarder provides type aliases or `PanelRowMapper` is updated. The task must explicitly list `PanelRowMapper.scala` as a file to update and specify what the new qualified name will be (`PanelTables.PanelRow` or `PanelRepository.PanelRow` via alias).

3. **Tasks 3.1 and 3.3 must specify that "private" methods being extracted must be widened to at least `private[services]`.** In `DashboardService` companion, `normalizeAppearance`, `validateDashboardLayoutPayload`, and `validateDashboardLayoutItems` are declared `private` (not `private[services]`). In `PanelService` companion, `validatePanelTypeOpt` is `private`. Once moved to a separate top-level object (even in the same package), `private` makes them inaccessible from `DashboardService`/`PanelService`. The tasks say "verify `private[services]` access" but do not say to change the modifier — an executor following the tasks literally would leave these as `private` in the new object and produce a compile error. The tasks must explicitly state these four methods must become `private[services]` (or equivalent) in their new home.

### Non-blocking notes

- Design D2 describes `DashboardSnapshotRepository(ctx, table, panelTable)(ec)` but the actual snapshot methods each create a fresh `val panelTable = TableQuery[...]` locally rather than sharing a construction-time reference. The tasks describe composition via an internal field (`DashboardRepository` holds a `DashboardSnapshotRepository` field). Either construction approach is fine, but the design doc and tasks are slightly inconsistent (design says constructor takes panelTable, tasks say internal field wired at construction). Not a blocking issue since both approaches work, but the executor should pick one and apply it consistently to avoid confusion.

- The proposal line-count estimates (DashboardRepository "384L → ≤250L target") assume removing the companion and the three snapshot ops reduces the class to ≤250L. The remaining class body (lines 1–169 minus overhead) is approximately 170L before delegation stubs are added for `duplicate`/`exportSnapshot`/`importSnapshot`. The delegation stubs themselves may add 15–25L. This leaves the primary file at ~185–195L. Verify the actual post-split count meets the ≤250L target — this is likely fine but was not explicitly modeled in the design.
