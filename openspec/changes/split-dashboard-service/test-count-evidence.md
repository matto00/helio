# test-count-evidence (HEL-1234)

Baseline: unmodified a256261dc, `nice -n 19 sbt testFull`, exit 0. Head: same command after the split, exit 0.
```
BASE:
[info] Total number of tests run: 6180
[info] Suites: completed 443, aborted 0
[info] Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
done 0
HEAD:
[info] Total number of tests run: 6180
[info] Suites: completed 443, aborted 0
[info] Tests: succeeded 6180, failed 0, canceled 4, ignored 0, pending 0
[info] All tests passed.
done 0
```

Per-suite counts (all 443 suites) diff base vs head: **empty** (`counts.sh` = suite header + `- test` lines). Related suites:
```
DashboardApplyProposalBindingSpec: 4
DashboardApplyProposalConfigSpec: 2
DashboardApplyProposalControlsSpec: 3
DashboardApplyProposalFormSeamSpec: 1
DashboardApplyProposalFormSpec: 11
DashboardApplyProposalSpec: 7
DashboardAuthoringParsingSpec: 10
DashboardAuthoringPromptSpec: 8
DashboardAuthoringRoutesSpec: 7
DashboardAuthoringServiceSpec: 24
DashboardContentsReplaceSpec: 5
DashboardGetOrCreateSpec: 7
DashboardLayoutRepairRlsSpec: 5
DashboardLayoutRepairRoutesSpec: 17
DashboardLayoutRepairSeamSpec: 6
DashboardLayoutValidationSpec: 28
DashboardModelSpec: 1
DashboardPanelAclSpec: 41
DashboardProposalProtocolSpec: 24
DashboardProposalServiceValidateSpec: 4
DashboardServiceLayoutPolicySpec: 3
DashboardSnapshotValidationSpec: 5
ExistenceNotLeakedRoutesSpec: 61
FirstRunDashboardServiceRollbackSpec: 4
PatchSetUndoPanelDashboardSpec: 5
PublicDashboardRoutesSpec: 23
```

ExistenceNotLeakedRoutesSpec passes unedited (61 tests). `git diff a256261dc -- backend/src/test` : empty.

## Guard scan (non-comment lines), base vs head: identical
```
== access-helper files
DashboardContentsService.scala 1
DashboardService.scala 2
PublicDashboardRoutes.scala 7
== Forbidden producers
DashboardContentsService.scala 1
DashboardService.scala 5
```
(DashboardService.scala: requireAccess( x2, ServiceError.Forbidden( x5, unchanged; no new file contains either.)

## Line counts
  291 backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala
   99 backend/src/main/scala/com/helio/services/dashboards/DashboardWrites.scala
   57 backend/src/main/scala/com/helio/services/dashboards/DashboardLayoutRepairWrite.scala
  108 backend/src/main/scala/com/helio/services/dashboards/DashboardSnapshotImport.scala
  555 total

`node scripts/check-scala-quality.mjs`: clean (soft warnings only on pre-existing files; see below for DashboardService.scala). No inline FQNs in new files (grep: only `package` lines match).
