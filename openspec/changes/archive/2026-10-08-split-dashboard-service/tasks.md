## Standing Constraints

- [C1] Every access-helper call (`requireAccess(`/`requireOwnerOnly(`/`authorizeResource...(`) and every `ServiceError.Forbidden(` producer stays literally in `DashboardService.scala` (ExistenceNotLeakedRoutesSpec guards; pinned count 5); pins are never edited.
- [C2] Zero diff under `backend/src/test` (import-only edits only if unavoidable, each justified); total and related-suite test counts equal the a256261dc baseline.
- [C3] Refactor discipline: behaviour-preserving only; bugs/dead code found become follow-ups in reports, never fixed here. Constructor, companion, public and `private[services]` signatures unchanged (`javap -public` diff empty after filtering `$anonfun$` lines; module fields `private val`).
- [C4] Never bare `sbt test` (use `sbt testFull`/`testOnly`); `nice -n 19`, <= 2 concurrent heavy workers; Bash timeout 600000; no pkill/pgrep/killall; no HUSKY=0 / `commit -n`; no writes under `~` outside the worktree.

### Backend

## 1. Baseline

- [x] 1.1 On the unmodified worktree run `nice -n 19 sbt testFull` (log to scratch); record total + related-suite counts (design D7b)
- [x] 1.2 BEFORE any edit, record guard sets, base `javap -public` output (D1 classes) and line counts on the unmodified tree (D7c/d)

## 2. Split

- [x] 2.1 Create `DashboardWrites` (insertNew, applyUpdate, writeUpdate verbatim); `create`/`update` delegate at the same points; compiles
- [x] 2.2 Create `DashboardLayoutRepairWrite` (repairLayout post-ownership tail verbatim, audit as function value); compiles
- [x] 2.3 Create `DashboardSnapshotImport` (importSnapshot body + validateImportPanels verbatim); `importSnapshot` one-line delegate; compiles
- [x] 2.4 `DashboardService.scala` <= 300 lines (else D8 measured floor, < 400), every new file <= 250; `node scripts/check-scala-quality.mjs` passes; eye-check `s"${...}"` for inline FQNs
- [x] 2.5 Update `services/dashboards/README.md` Holds list

### Tests

## 3. Evidence

- [x] 3.1 Write `move-evidence.md` (D7a: color-moved summary, MATCH script + red run, justified non-moved changed lines)
- [x] 3.2 Re-run `nice -n 19 sbt testFull`; totals and related-suite counts equal baseline; write `test-count-evidence.md` incl. guard scans (D7c) and `javap -public` diff (D7d)
- [x] 3.3 Confirm `git diff <base>...HEAD -- backend/src/test` empty; pre-commit hooks pass on commit; write `files-modified.md`
