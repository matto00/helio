# Red evidence: OutputDeleteRacesPanelCreateSpec on the pre-fix code (no V130)

State at the time: only the new spec file existed; `backend/src/main/resources/db/migration/` ended at V129. Embedded
Postgres, NOBYPASSRLS app role (`helio_migration_test`), `nice -n 19`, `HELIO_TEST_JVM_XMX=3g`. Interleave driven by
observed per-racer lock waits (`awaitLockWaitOf`, pools named `create-*` / `delete-*`), no sleeps.

Command (from backend/):
`HELIO_TEST_JVM_XMX=3g nice -n 19 sbt -J-Xmx3g 'testOnly *OutputDeleteRacesPanelCreateSpec'`
exit code: 1 (Tests: succeeded 1, failed 5)

Legend: PROOF = red pre-fix (40P01), GUARD = green before and after. Either side may be the deadlock victim
(Postgres picks), shown as (create, delete).

```
a panel create racing an Output-removing delete
- W3 OutputRepository.deleteWithPanelsInternal, GUARD          states (create, delete) = (None,None)
- W4 PipelineRepository.delete  *** FAILED ***                 (Some("40P01"), None) was not equal to (None, None)
- W5 PipelineStepRepository.deleteInternal  *** FAILED ***     (Some("40P01"), None) was not equal to (None, None)
- W6 root removal  *** FAILED ***                              (None, Some("40P01")) was not equal to (None, None)
- W7 DataSourceRepository.delete  *** FAILED ***               (None, Some("40P01")) was not equal to (None, None)
- W8 WorkspaceTeardownRepository.teardown  *** FAILED ***      (Some("40P01"), None) was not equal to (None, None)
Tests: succeeded 1, failed 5, canceled 0, ignored 0, pending 0
```

Postgres server log for the W4 case (the inversion itself: create holds D and wants KEY SHARE on O via the panels.output_id
FK; the pipeline delete holds O and its cascade wants D):

```
ERROR:  deadlock detected
DETAIL:  Process 2153555 waits for ShareLock on transaction 1018; blocked by process 2153559.
	Process 2153559 waits for ShareLock on transaction 1017; blocked by process 2153555.
	Process 2153555: insert into "panels" (...)  values (...)
	Process 2153559: delete from "pipelines" where ("pipelines"."id" = '...') and ("pipelines"."owner_id" = '...')
CONTEXT:  while locking tuple (0,2) in relation "outputs"
	SQL statement "SELECT 1 FROM ONLY "public"."outputs" x WHERE "id" OPERATOR(pg_catalog.=) $1 FOR KEY SHARE OF x"
```

Labels: W4, W5, W6, W7, W8 = PROOF (red). W3 = GUARD (it deletes the panels explicitly before the Output, so V122 locks
D before O; green by construction).
