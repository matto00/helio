## Skeptic Report — design gate (round 2)

### What I verified (with evidence)

**1. Artifact timestamps confirm this is a revised design.**
`design.md` and `tasks.md` were last modified at 14:13, after `skeptic-design-1.md` was written at 14:11. The design was revised to address CR1/CR2/CR3 from round 1.

**2. CR1 and CR2 (companion extraction / PanelRowMapper broken references) — resolved.**
Design D1 now states "companion objects remain in place (NOT extracted)." `DashboardTables.scala` and `PanelTables.scala` are no longer planned. Tasks 1.x and 2.x operate only on trait extraction for bulk ops, not companion bodies. `PanelRowMapper.scala`'s 10 references to `PanelRepository.PanelRow` remain valid because `object PanelRepository` stays in `PanelRepository.scala`. Confirmed by reading current tasks.md — no companion extraction appears. CR1 and CR2 are closed.

**3. CR3 (private visibility widening for service helpers) — resolved.**
Design D3 explicitly states `normalizeAppearance`, `validateDashboardLayoutPayload`, `validateDashboardLayoutItems` (currently `private` in `DashboardService` companion) and `validatePanelTypeOpt` (currently `private` in `PanelService` companion) must be widened to `private[services]` when moved to their new objects. Tasks 3.2 and 4.2 name these methods and specify the widening. Confirmed against actual source: `grep -n "private def normalizeAppearance\|private def validateDashboardLayout\|private def validatePanelTypeOpt"` confirms they are indeed `private` (not `private[services]`) in the current source at lines 296, 302, 316 (DashboardService) and 342 (PanelService). CR3 is closed.

**4. New issue — self-type trait access to private members is incomplete in design and tasks.**
Design D2 states: "Self-typing gives the extracted traits full access to `ctx`, `table`, `panelTable`, `permTable`, and private helpers without argument threading." This claim is incorrect for Scala 2 access rules.

Verified by reading the source:

`DashboardRepository` constructor: `class DashboardRepository(ctx: DbContext)(implicit ec: ExecutionContext)` — `ctx` is a plain constructor parameter, stored as a private field. `table` is declared `private val table = TableQuery[DashboardTable]` (line 19). `panelRowToDomain` is `private def panelRowToDomain(row: PanelRepository.PanelRow): Panel` (line 23).

In Scala 2, a self-typed trait (`trait DashboardSnapshotOps { self: DashboardRepository => }`) can call methods on `self`, but only accesses members that are `protected` or public. `private` members — including un-annotated constructor params stored as private fields and `private val`/`private def` members — are NOT accessible from a mixin trait, even with self-typing. Private means "accessible only within the enclosing class body." A trait body is not the class body, even after mixin.

The snapshot methods being extracted (`duplicate`, `exportSnapshot`, `importSnapshot`) use:
- `ctx.withSystemContext(...)` — `ctx` is private (constructor param)
- `table.filter(...)` — `table` is `private val`
- `rowToDomain(...)` — widening planned in task 1.1 (correct)
- `domainToRow(...)` — widening planned in task 1.1 (correct)
- `panelRowToDomain(...)` at lines 207 and 248 — `private def`, widening NOT mentioned in tasks

The mutation methods being extracted from `PanelRepository` (`duplicate`, `batchUpdate`) use:
- `ctx.withSystemContext(...)` — `ctx` is private (constructor param, line 13)
- `table.filter(...)` — `table` is `private val` (line 18)
- `rowToDomain(...)` — widening planned in task 2.1 (correct)
- `domainToRow(...)` — widening planned in task 2.1 (correct)

Tasks 1.1 and 2.1 only specify widening `rowToDomain`/`domainToRow` to `protected`. They do not mention widening `ctx`, `table`, or `panelRowToDomain`. An executor following these tasks will produce traits that reference private members and the code will not compile.

Note: changing `ctx: DbContext` to `protected val ctx: DbContext` in the constructor does not change the external call signature (`new DashboardRepository(ctx)` is still valid) — it only promotes the param to a protected field. Similarly, `private val table` to `protected val table` is an internal change only. These widenings are required for the trait approach to compile, and they must be listed explicitly in the tasks.

**5. Proposal.md inconsistency with design.md (non-blocking).**
`proposal.md` describes extracting `DashboardTables.scala` and `PanelTables.scala` and states "4 files split into 8 files." The revised design D1 drops the companion extractions. The "8 files" count in the proposal is stale. The executor works from `design.md` and `tasks.md`, which are internally consistent. This is a documentation nit, not an execution blocker.

**6. Line count targets — validated as achievable.**
- DashboardRepository snapshot ops (lines 174–344): 171L extracted. 384L - 171L = ~213L remaining. Under 250L.
- PanelRepository mutation ops (lines 165–298): 134L extracted. 361L - 134L = ~227L remaining. Under 250L.
- DashboardService companion body (lines 211–332): ~122L extracted to DashboardServiceValidation. ~210-215L remaining. Under 300L.
- PanelService companion body (lines 253–347): ~95L extracted to PanelServiceHelpers. ~255L remaining. Under 300L.
- All 4 new files: comfortably under 300L based on extracted line counts plus boilerplate.

**7. Test stability — verifiable path confirmed.**
`DashboardSnapshotValidationSpec.scala` calls `DashboardService.validateSnapshotPayload(...)`. Task 3.3 keeps a public forwarding def in the `DashboardService` companion that delegates to `DashboardServiceValidation.validateSnapshotPayload`. This preserves the external call path. No test changes required. Confirmed by reading the existing test reference pattern in skeptic-design-1.md (line 47) and verifying the companion still has this def at line 220 of the current source.

**8. `Main.scala`/`ApiRoutes.scala` wiring — no changes needed confirmed.**
The design correctly identifies that service/repository constructor signatures are unchanged. `DashboardSnapshotOps` and `PanelMutationOps` are mixed in at the class declaration level, not at the constructor call site. Verified: the traits add no constructor arguments.

### Verdict: REFUTE

### Change Requests

1. **Tasks 1.1 and 2.1 must enumerate ALL private members the extracted traits need, not just `rowToDomain`/`domainToRow`.** In Scala 2, self-typed traits cannot access `private` class members. The tasks currently say "Widen `private def rowToDomain` / `domainToRow` ... to `protected`" but omit the following which are also required:
   - `DashboardRepository`: widen `ctx` (constructor param, used at lines 215, 268, 343 by snapshot methods) to `protected val ctx: DbContext`; widen `private val table` (line 19) to `protected val table`; widen `private def panelRowToDomain` (line 23, used at lines 207 and 248 in the snapshot methods being extracted) to `protected`.
   - `PanelRepository`: widen `ctx` (constructor param, used at lines 203, 297 by mutation methods) to `protected val ctx: DbContext`; widen `private val table` (line 18) to `protected val table`.
   Without these widenings, `DashboardSnapshotOps` and `PanelMutationOps` will fail to compile with "symbol not accessible" errors. Design D2's claim that self-typing "gives the extracted traits full access to `ctx`, `table`, `panelTable`, `permTable`" must be corrected to say these must first be widened to `protected`.

### Non-blocking notes

- `proposal.md` says "4 files split into 8 files" and describes `DashboardTables.scala`/`PanelTables.scala` which are no longer planned. The proposal is stale but does not affect execution. Recommend updating for completeness.
- Design D2 says self-typing "gives access to private helpers without argument threading" — this is wrong in general; it gives access to protected/public helpers. Since tasks now need to explicitly widen everything, this sentence should be corrected to avoid confusing future readers, but it is not an execution blocker once CR above is addressed.
