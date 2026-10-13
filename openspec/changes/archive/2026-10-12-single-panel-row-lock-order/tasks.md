## Standing Constraints

- [C1] HEL-1526 is in scope (owner fold-in): replaceContents must not overwrite a layout it did not read, with its own red-first NOBYPASSRLS concurrent-transaction spec; close HEL-1526 at delivery with a PR comment.
- [C2] Never start `sbt run` or any backend against the shared dev DB in this run (this lane's V128 has a different checksum from HEL-1434's V128; applying either to the shared dev DB breaks the other lane); verify with `sbt testFull` (embedded Postgres) only.
- [C4] The new migration takes exactly (max version on origin/main)+1, re-checked immediately before the delivery push and by the auditor before merge; a clash then fails loudly as a duplicate version.
- [C5] The HEL-1526 spec's gate (LOCK TABLE panels IN SHARE MODE) is a test-harness change only; adopting it must not need production-code changes beyond design D3 (owner answer adopt-skeptic-fix) -- otherwise escalate.
- [C3] Every red-first spec is shown failing on the pre-fix code (recorded output) before the fix lands; never edit V1-V127.

### Backend

## 1. Split PatchSetPreviewProjection (behaviour-preserving, own commit)

- [x] 1.1 Split `PatchSetPreviewProjection.scala` into the dispatcher + `PatchSetPreview{Panel,Dashboard,Source,Pipeline,Step}Projection.scala` per design D5; drop the unused import; refresh docs. Verify: every file < 250 lines and existing patchsets specs pass unchanged
- [x] 1.2 Commit the split alone before any behaviour change. Verify: `git show --stat` touches only the split files and doc references

## 2. Panel lock function and Scala helper

- [x] 2.1 Re-check origin/main migrations; add `V<max+1>__lock_panels_for_deletion.sql` (V128 at planning time; C4 -- HEL-1434 merged V128 meanwhile, so this change is V129, re-checked against origin/main before the commit) with `hel1498_lock_panels` per design D1. Verify: Flyway migrates on embedded Postgres as the NOBYPASSRLS role
- [x] 2.2 Add `PanelRowLocks.lockForDeletion` (design D2) and make `DashboardRepository.lockPanelRows`/`delete` use it. Verify: existing `DashboardDeleteRacesPanelDeleteSpec` passes

## 3. Wire every multi-panel writer (design D2)

- [x] 3.1 W1 `replaceContents` per design D3 (HEL-1526: required layout, panel lock, dashboard FOR UPDATE, write computed layout, return re-read row); update `DashboardContentsService`. Verify: W1 race + HEL-1526 specs green
- [x] 3.2 W2 `batchUpdate`: id-ordered `FOR UPDATE` over its ids before the item loop. Verify: W2 race spec green
- [x] 3.3 W3 output delete: one system txn `OutputRepository.deleteWithPanelsInternal` (lock, panel DELETE RETURNING id, output DELETE) called by `OutputService.delete`. Verify: W3 race spec green
- [x] 3.4 W4 `PipelineRepository.delete`, W5 `PipelineStepRepository.deleteInternal` (tail + step, before first write), W6 root removal (lock is the first step of `PipelineStepRepository.removeRootCascadeAction`, which `PipelineRootWrites.removeRoot` composes first), W7 `DataSourceRepository.delete`. Verify: W4-W7 race specs green
- [x] 3.5 W8 teardown: one lock call over tagged dashboards/pipelines/sources replacing `lockPanelRows`; update the comment. Verify: W8 race spec green
- [x] 3.6 Remove dead deleters (`PipelineStepRepository.delete`, `PipelineRootRepository.remove`, `OutputRepository.deleteByNodeInternal`) after confirming zero main callers. Verify: compile + grep shows no callers

## 4. Cumulative patch-set preview (design D4)

- [x] 4.1 Extract a pure placement-size helper from `PanelBindingChecks.defaultSizesFor` used by both apply and preview. Verify: existing panel-create placement specs pass
- [x] 4.2 Add `PatchSetPreviewOverlay` and thread it through `PatchSetPreviewService.previewResolved` and the projections (read + extend rules, `expectedLayoutVersion` conflict, removed-target rejection). Verify: cumulative parity specs green
- [x] 4.3 Make the dashboard-delete impact count overlay-aware. Verify: impact spec green
- [x] 4.4 Keep `before` and fingerprints pre-apply. Verify: fingerprint GUARD spec green

### Tests

## 5. Concurrency specs (VerifiedEmbeddedPostgres, NOBYPASSRLS app role)

- [x] 5.1 Extract `LockRaceSupport` (pools, backendPid, awaitLockWait, strict sqlState rethrowing non-PSQL errors); `DashboardDeleteRacesPanelDeleteSpec` asserts `(None, None)`. Verify: spec green
- [x] 5.2 Red-first race specs W1-W8 per design D6 (two shared panels, B inserted first; W4/W8 on a grantee's dashboard; W2 drives the repo method and post-fix accepts success or exactly the not-found exception). Verify: recorded 40P01 failures pre-fix, `(None, None)` (W2: gate `None`) post-fix
- [x] 5.3 HEL-1526 red-first spec per design D6 (zero-panel dashboard; gate holds LOCK TABLE panels IN SHARE MODE; concurrent `insertPlaced`; start order gate, replace, create; per-racer lock-wait detection); asserts `(None, None)` and panel/item sets equal in every breakpoint; a separate non-racing spec, with a layout different from stored, asserts returned layoutVersion == stored. Verify: recorded red pre-fix, green post-fix

## 6. Preview parity specs

- [x] 6.1 `PatchSetPreviewCumulativeSpec` PROOF cases for every delta-spec scenario (preview `after` == apply `resultingState`; 404/409 rejections). Verify: recorded red pre-fix, green post-fix
- [x] 6.2 GUARD cases: fingerprints unchanged + apply not stale; `before` == apply `priorState`; unrelated multi-edit sets unchanged. Verify: green before and after
- [x] 6.3 Prefix the 2 ghost-layout guard cases (`PatchSetPreviewGhostLayoutSpec.scala:73,79`) with `GUARD:` and add the RED/GUARD legend. Verify: spec green

## 7. Verification

- [x] 7.1 Full `sbt testFull` (nice -n 19, default local caps) and `check:scala-quality`. Verify: green, recorded output
