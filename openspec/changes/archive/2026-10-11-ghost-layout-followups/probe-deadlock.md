# Probe: dashboard delete vs panel delete (HEL-1485 item 2)

## Result: REPRODUCED (40P01), then fixed by pre-locking panel rows

Spec: `backend/src/test/scala/com/helio/infrastructure/persistence/dashboards/DashboardDeleteRacesPanelDeleteSpec.scala`
(embedded Postgres via `VerifiedEmbeddedPostgres.start`, full Flyway chain, NOSUPERUSER / NOBYPASSRLS schema owner).

Roles: the panel-deleting side is a raw session as the NOSUPERUSER/NOBYPASSRLS owner role with the RLS user GUC
set (the app pool's shape). The dashboard-deleting side runs the real repositories: `DashboardRepository.delete`
on a pool that `SET ROLE helio_privileged` (NOLOGIN, BYPASSRLS here, reached by SET ROLE as the privileged pool
reaches it), and `WorkspaceTeardownRepository.teardown` on the app pool under the owner's RLS context.

Interleave (driven by observed `wait_event_type = 'Lock'`, no sleeps as proof): panel side holds P with
`SELECT ... FOR UPDATE` (the lock a `DELETE` of P holds before its V122 trigger runs); the dashboard delete starts,
takes D and blocks on P through the FK cascade; then the real `DELETE FROM panels WHERE id = P` fires the real V122
trigger, which wants D. The spec proves the cycle can form, not its production frequency (C1).

### Red, unfixed code (`evidence/red-deadlock.log`)
- `DashboardRepository.delete`: `panel side=None dashboard side=Some(40P01)`
- `WorkspaceTeardownRepository.teardown`: `panel side=None teardown side=Some(40P01)`

### Green, fixed code (`evidence/green-deadlock.log`)
Both pass. Fix: `DashboardRepository.lockPanelRows` (`ORDER BY id FOR UPDATE`) as the first write-phase statement
of `DashboardRepository.delete` and of `WorkspaceTeardownRepository.planAndExecute` (before `deletePipelines`, whose
outputs -> panels cascade already fires V122). No migration (V122/V123 untouched).

## Residuals, scoped out (follow-up candidates)
1. Panel <-> panel order: other multi-panel deleters (`replaceContents`, output/pipeline/step FK cascades,
   `batchUpdate`) lock panel rows in scan/request order, not id order, so a dashboard delete racing one of them over
   two or more shared panels can still 40P01, as before. Not a regression.
2. Teardown: `deletePipelines`' cascade also strips (and V122-locks) UNTAGGED dashboards holding panels bound to the
   tagged pipelines' outputs. The pre-lock covers only the tagged dashboards, so a later statement in the same
   transaction needing a panel row on such a dashboard is dashboard-then-panel. Pre-existing, outside this race.
