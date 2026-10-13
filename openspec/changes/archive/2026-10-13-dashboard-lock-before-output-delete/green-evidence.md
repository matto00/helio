# Green evidence (HEL-1534)

## D3 enumeration: transactions that lock/write an Output / pipeline / step / root / source row and later a dashboard row
Method: grep of every Scala writer of `dashboards` (`DashboardTable`, raw `UPDATE/INSERT INTO/DELETE FROM dashboards`) and of
every migration trigger on outputs / pipelines / pipeline_steps / pipeline_roots / data_sources.
- Scala dashboard writers: `DashboardRepository`, `DashboardContentsOps`, `PanelLayoutPlacement`, `WorkspaceTeardownRepository`
  (+ `PanelRepository`, read-only `exists` checks at :70, :149). `DashboardRepository.delete/replaceContents` and teardown call
  `lockForDeletion` first (panels, then dashboards, now by V130 inside the function); create/placement lock D first.
- Triggers on outputs / pipelines / pipeline_steps / pipeline_roots / data_sources that reach dashboards: none (`grep CREATE TRIGGER ... ON <those>` = no hits for dashboard writes; V99/V100 zero-root guard touches pipelines/roots only; V128 enqueues stored-object deletions only).
- Result: no O-then-D writer exists. Residual D2 documented in V130 header and `PanelRowLocks`.

## Green runs (from backend/, `HELIO_TEST_JVM_XMX=3g HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt -J-Xmx3g`)
`testOnly *OutputDeleteRacesPanelCreateSpec *PanelWriterLockOrderRaceSpec *PipelineCascadeLockOrderRaceSpec *DashboardDeleteRacesPanelDeleteSpec *ReplaceContentsLayoutRaceSpec *ResourceTagMigrationSpec *OutputHistoryPublicRoutesSpec *PublicProvenanceRoutesSpec *PatchSetUndoPanelDashboardSpec *AlertRuleRepositorySpec`
exit 0: Suites: completed 10, aborted 0; Tests: succeeded 51, failed 0.
OutputDeleteRacesPanelCreateSpec: W3 GUARD, W4, W5, W6, W7, W8 all `states (create, delete) = (None,None)`
(red before V130: W4/W5/W8 create victim, W6/W7 delete victim; see red-evidence.md).

## Full backend gate
`cd backend && HELIO_TEST_JVM_XMX=3g HEL924_TEST_GROUP_CONCURRENCY=1 nice -n 19 sbt -J-Xmx3g testFull` exit 0:
Total number of tests run: 7729; Suites: completed 581, aborted 0; Tests: succeeded 7729, failed 0, canceled 4. All tests passed.
