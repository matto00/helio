## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `90fa9afd5da706997eecb7b2d357a3ee7e5e0f69` (unchanged from start to end of review).
Base resolved live via `resolve-review-base.sh ... main origin` -> `a256261dcc3990c5b35aca9eec6707aa0408db52`.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/split-dashboard-service/hel-1234`.
- **Diff scope:** `git diff --stat a256261dc...HEAD` touches only `services/dashboards/{DashboardService,DashboardWrites,DashboardLayoutRepairWrite,DashboardSnapshotImport}.scala`, the dashboards `README.md`, and openspec change artifacts. There are **zero test-file changes**.
- **AC1, sizes:** `wc -l` gives DashboardService.scala 291 (base 473), DashboardWrites 99, DashboardLayoutRepairWrite 57 and DashboardSnapshotImport 108. The service is under 300 and every new file is under 250.
- **AC2, verbatim move (my own mechanical check, not the executor's `move-match.py`):** I built a multiset diff of stripped non-blank removed lines against added lines across `git diff a256261dc...HEAD -- backend/src/main`. Every removed line that is not re-added falls into one of these groups:
  - 2 narrowed imports
  - 4 `insertNew(`/`applyUpdate(` call sites, now `writes.`-qualified
  - 2 `private def insertNew`/`applyUpdate` signature lines, now `def` on a `private[dashboards]` class
  No body, message, audit-action or metadata line was altered. `writeUpdate` and `validateImportPanels` stay `private`.
- **AC2, semantics:**
  - `audit` is a `def` (DashboardService.scala:61), so eta-expanding it in the `private val` initialisers at :53-54 captures `this` safely.
  - `ec` and `outputRepo` are constructor params, and `require(outputRepo != null)` still runs first.
  - Both moved audit calls pass `metadata` explicitly.
  - In DashboardSnapshotImport, `validateSnapshotPayload` resolves to `DashboardServiceValidation.validateSnapshotPayload`, which is the same impl the companion forwarder calls (:289-290).
  - The Future chain is unchanged and each delegate is a direct tail call at the original position, so there is no new hop or reordering.
- **AC3, API compatibility:**
  - I compiled base from `git archive a256261dc backend` into scratchpad (no git-admin writes). I confirmed base `javap -p` contains `private insertNew/applyUpdate/writeUpdate/validateImportPanels`, and head contains `$anonfun$layoutRepair$1`. Both are self-authenticating as base and head.
  - `javap -public` diff with `anonfun` lines filtered is **empty** for `DashboardService`, `DashboardService$`, `DashboardService$CreateDashboardInput` and `DashboardService$CreateDashboardInput$`. The unfiltered diff has 0 non-anonfun changed lines in each.
  - The constructor (repo, accessChecker, auditService, outputRepo)(ec) and `$lessinit$greater$default$3` (the `auditService = null` default) are present.
- **AC4, guards:**
  - `grep -c "ServiceError.Forbidden("` gives 5 in DashboardService.scala at both base and head.
  - None of the 3 new files references `accessChecker` or `Forbidden(`. The only match is a scaladoc mention in DashboardWrites:13.
  - The ExistenceNotLeakedRoutesSpec pins (:395-402, :523 `"DashboardService.scala" -> 5`) are unedited.
- **AC5, full suite (fresh, my own run):** `cd backend && nice -n 19 sbt testFull` at HEAD gave `Total number of tests run: 6180 / Suites: completed 443, aborted 0 / Tests: succeeded 6180, failed 0, canceled 4 / All tests passed. / exit 0`. This matches the executor's recorded base count of 6180/443.
- **AC5, quality:**
  - `node scripts/check-scala-quality.mjs` exited 0, with soft warnings only. DashboardService.scala is 292 by the checker's split-count.
  - Grepping for inline FQNs on non-import lines of the new files gives no hits. The only `s"${...}"` interpolations use `entry.snapshotId` and `outputId.value`.
- **UI:** N/A. The change is backend-only.

### Verdict: CONFIRM

### Non-blocking notes
- DashboardService.scala:214-216 now has three consecutive blank lines where `applyUpdate`/`writeUpdate` were removed. This is cosmetic.
- No mtime-ordering evidence was relied upon. Base and head class identity was established by content (`javap -p` member names).
