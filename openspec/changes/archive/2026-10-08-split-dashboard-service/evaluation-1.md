## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `90fa9afd5da706997eecb7b2d357a3ee7e5e0f69`. Diff base resolved live through `resolve-review-base.sh`: `a256261dcc3990c5b35aca9eec6707aa0408db52` (it equals the merge-base). The branch has one commit.
Scope: backend-only structural refactor. `DashboardService.scala` was split into `DashboardWrites`, `DashboardLayoutRepairWrite` and `DashboardSnapshotImport`, and the README was updated.

### Phase 1: Spec Review — PASS
Issues: none.
- AC1 (split along seams; entry file at most 300; new files at most 250):
  - `DashboardService.scala` has 291 newline-terminated lines. `check-scala-quality` reports 292 because it counts `text.split("\n").length` (`scripts/check-scala-quality.mjs:77-80`), and that count includes the empty element after the final newline. Every file gets the same +1, so there is no real discrepancy.
  - The new files have 99, 57 and 108 lines.
  - The D8 fallback was not needed.
- AC2 (behaviour-preserving): verified below.
- AC3 (public API compatibility): verified with my own `javap` run. See Phase 2.
- AC4 (ExistenceNotLeakedRoutesSpec guards): verified. See Phase 2.
- AC5 (suite, zero test diff, move evidence, scala-quality, no inline FQNs): verified. See Phase 2.
- Every task in `tasks.md` is `[x]` and matches the diff.
- No scope creep: `DashboardLayoutRepair.scala`, `DashboardServiceValidation.scala`, `ApiRoutes` and the tests are untouched.
- `workflow-state.md` CONSTRAINTS C1 to C4 are all honoured. My own runs used `testOnly` under `nice -n 19`, with at most 2 heavy workers.

### Phase 2: Code Review — PASS
Issues: none blocking.

Independent verification (fresh runs, not the executor's report):

1. **Move check.**
   - I re-ran the executor's `move-match.py` against `git show a256261dc:.../DashboardService.scala`. Result: `RESULT ALL MATCH`, exit 0.
   - I also wrote an independent check. It counts whitespace-stripped non-blank lines in the original file against the four new files combined. Every line found only in the original is one of the following:
     - the 2 narrowed imports
     - the 2 `insertNew(` and 2 `applyUpdate(` call sites, which now go through the module (`writes.`-qualified)
     - the 2 `private def` signature lines
   - Every line found only in the new files is one of the following:
     - scaffolding: package, imports, class headers, braces, constructor params, scaladoc
     - the three `private val` fields and their 2-line comment
     - the three delegate calls
     - the signature lines of `repairOwned` and the module `importSnapshot`
   - No body or message line changed. This matches the executor's D4 list exactly.
2. **javap -public.**
   - Base: I compiled a256261dc in a throwaway detached worktree (since removed; `git worktree list` shows no remnant).
   - Head: classes from my own `testOnly` compile.
   - Classes checked: `DashboardService`, `DashboardService$`, `DashboardService$CreateDashboardInput`, `DashboardService$CreateDashboardInput$`.
   - The diff with `$anonfun$` lines filtered is **empty** for all four classes.
   - The unfiltered diff has **0** non-`$anonfun$` changed lines.
   - `javap -p` shows the new fields are `private final` with `private` accessors, and none is public.
3. **Guard scan.**
   - In `services/dashboards/`, non-comment access-helper calls appear only in `DashboardService.scala:200,252` (`requireAccess`), plus the existing `DashboardContentsService.scala:146`.
   - There are 5 `ServiceError.Forbidden(` producers in `DashboardService.scala` (141, 161, 202, 230, 254), the same as base.
   - None of the 3 new files references `accessChecker`, `Forbidden` or any access helper.
   - The ExistenceNotLeakedRoutesSpec pins (lines 395-402, 523) are unedited.
4. **Zero test diff.** `git diff a256261dc...HEAD -- backend/src/test` is empty.
5. **Tests.** I ran `nice -n 19 sbt 'testOnly *Dashboard* *ExistenceNotLeakedRoutesSpec *PanelService* *ImportExport* *Sharing*'` with exit 0.
   - Result: 377 run, 377 succeeded, 0 failed, 33 suites, 0 aborted.
   - Per-suite counts match the executor's baseline table:

     | Suite | Tests |
     |---|---|
     | ExistenceNotLeakedRoutesSpec | 61 |
     | DashboardServiceLayoutPolicySpec | 3 |
     | DashboardSnapshotValidationSpec | 5 |
     | DashboardLayoutRepairRlsSpec | 5 |
     | DashboardLayoutRepairRoutesSpec | 17 |
     | DashboardPanelAclSpec | 41 |
     | DashboardLayoutValidationSpec | 28 |
     | DashboardLayoutRepairSeamSpec | 6 |
     | DashboardGetOrCreateSpec | 7 |

   - I did not re-run the full `testFull` (6180). The executor's base and head totals for it are recorded in `test-count-evidence.md`.
6. **`node scripts/check-scala-quality.mjs`.** Clean, with soft warnings only. `DashboardService.scala` gets a warning at 292 by the checker's count, which is under the 300 living-spec target.
7. **Inline FQNs.**
   - Grepping `\b(com|java|javax|scala|spray|org)\.[a-z]` over non-import/package lines of all four files gives zero hits.
   - The only `s"${...}"` interpolations are `DashboardSnapshotImport.scala:74,87,92`. They use `entry.snapshotId` and `outputId.value`, which are not FQNs.

Semantic checks:
- `audit` is a `def` (`DashboardService.scala:61`). Eta-expanding it in the `private val` initialisers (lines 53-54) is safe even though they come before the definition: it captures `this`, and `auditService` is a constructor field. The `require` still runs first.
- Both moved audit calls pass `metadata` explicitly, so the default parameter is never needed.
- Name resolution inside `DashboardSnapshotImport` changes, as design D3 documents:
  - `validateSnapshotPayload` now resolves to `DashboardServiceValidation.validateSnapshotPayload`, which is exactly what the companion forwarder calls (`DashboardService.scala:289-290`).
  - `repairImportedLayoutGeometry` and `validateDashboardLayoutPayload` resolve to `DashboardServiceValidation` (`:94`, `:139`) both before and after the move.
- No added Future hops or wrappers. Each delegate is a direct tail call at the original position.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `DashboardService.scala:213-215`: removing `applyUpdate`/`writeUpdate` left three consecutive blank lines between `update` and the `repairLayout` scaladoc. The base already had two there. This is cosmetic only and can be collapsed if the file is touched again.
