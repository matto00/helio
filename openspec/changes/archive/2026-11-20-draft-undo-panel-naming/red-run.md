# HEL-1792 red run on main code (spec only; no implementation)

Cases a,e,f,b,c red; d is a guard (green on main, fingerprint backstop). Full log: .concertino/scratch/HEL-1792/red-run.log (evidence copy persisted).

```
[info] - should run on a role that does not bypass RLS
[info] undo of a draft save that created an Output now carrying panels
[info] - should name the panels A can read by title and dashboard, count the one A cannot read, and leak no id *** FAILED ***
[info]   "Undo refused: it would remove or has removed panel 0e3a760f-b9d4-4938-b6ee-fb361fd29cc9 (Output fee95a60-8477-4128-ac6c-c3a627c5bb39), panel 3419abfb-dd80-4edd-b5c7-378e561266fc (Output fee95a60-8477-4128-ac6c-c3a627c5bb39), panel 3c0e3610-a51c-4fa2-b6d7-5ebb0d39ac51 (Output fee95a60-8477-4128-ac6c-c3a627c5bb39), which undo cannot recreate or delete; nothing was changed." did not include substring ""P1 visible one" on dashboard "Standings hel1792 a"" (DraftUndoPanelNamingSpec.scala:278)
[info] - should name an alert rule the undoing user owns by its name only, and carry no rule id *** FAILED ***
[info]   "Undo refused: it would remove or has removed alert rule 26f49a46-9ea9-4a0d-9c67-aef8258e784d "Revenue floor rule" (Output 2749c627-0f90-4081-815e-718d2afa789f), which undo cannot recreate or delete; nothing was changed." did not include substring "alert rule "Revenue floor rule"" (DraftUndoPanelNamingSpec.scala:303)
[info] - should count an alert rule another user owns, carrying neither its id nor its name (editor-saver undo) *** FAILED ***
[info]   "Undo refused: it would remove or has removed alert rule 716557c5-7a35-437b-9796-54bf5f301344 "A secret rule name" (Output 530f1ec4-6859-4d4c-9111-6c648465fb4f), which undo cannot recreate or delete; nothing was changed." did not include substring "1 alert rule(s) you do not own" (DraftUndoPanelNamingSpec.scala:319)
[info] undo of a draft save whose cascade removed an Output with dependents
[info] - should be count-only: no panel id, no alert rule id, no rule name *** FAILED ***
[info]   "Undo refused: it would remove or has removed panel 1d6af156-a950-4355-8250-70621eaf35f6 (Output ab79050a-1b89-4608-9b7e-9fa86760b621), panel bd2ee1e7-a4cd-4fb6-ac2b-5d4eead3d8fb (Output ab79050a-1b89-4608-9b7e-9fa86760b621), alert rule ffa2f580-8b16-4ba6-93ee-f8da337dbd67 "B removed rule" (Output ab79050a-1b89-4608-9b7e-9fa86760b621), which undo cannot recreate or delete; nothing was changed." did not include substring "the save removed 2 panel(s) and 1 alert rule(s) with its Outputs" (DraftUndoPanelNamingSpec.scala:343)
[info] - should combine with the created-Outputs refusal under one prefix and one suffix (D2a) *** FAILED ***
[info]   "Undo refused: it would remove or has removed panel 632a5500-a265-4c39-88be-985bffe19e17 (Output d25fc49c-2f3d-40c5-826c-6098d019705b), alert rule cf6d2152-5d50-4536-ae4a-88167ed40158 "Removed rule c" (Output d25fc49c-2f3d-40c5-826c-6098d019705b), panel ef68745c-f229-43da-8346-cc9ba8440480 (Output 5ef8ef43-8a6c-4723-b65a-b44808bf9b60), which undo cannot recreate or delete; nothing was changed." did not include substring "the save removed 1 panel(s) and 1 alert rule(s) with its Outputs" (DraftUndoPanelNamingSpec.scala:357)
[info] a panel bound to a created Output after the pre-check (a GUARD, green on main via the fingerprint backstop)
[info] - should answer PATCH_SET_STALE naming no panel id, and change nothing
18:43:06.110 INFO  [pool-1-thread-1] com.zaxxer.hikari.HikariDataSource - HikariPool-2 - Shutdown initiated...
18:43:06.111 INFO  [pool-1-thread-1] com.zaxxer.hikari.HikariDataSource - HikariPool-2 - Shutdown completed.
18:43:06.112 INFO  [pool-1-thread-1] com.zaxxer.hikari.HikariDataSource - HikariPool-1 - Shutdown initiated...
18:43:06.112 INFO  [pool-1-thread-1] com.zaxxer.hikari.HikariDataSource - HikariPool-1 - Shutdown completed.
18:43:06.114 INFO  [postgres:pid(2639838)] i.z.t.d.p.embedded.EmbeddedPostgres - 2026-11-20 18:43:06.114 PST [2639841] LOG:  received fast shutdown request
18:43:06.115 INFO  [postgres:pid(2639838)] i.z.t.d.p.embedded.EmbeddedPostgres - 2026-11-20 18:43:06.114 PST [2639841] LOG:  aborting any active transactions
18:43:06.214 INFO  [pg_ctl:pid(2640078)] i.z.t.d.p.embedded.EmbeddedPostgres - waiting for server to shut down.... done
18:43:06.215 INFO  [pg_ctl:pid(2640078)] i.z.t.d.p.embedded.EmbeddedPostgres - server stopped
18:43:06.215 INFO  [pool-1-thread-1] i.z.t.d.p.embedded.EmbeddedPostgres - 211b82a2-2515-4895-ba7f-0ce013652f27 shut down postmaster in 00:00:00.102
18:43:06.260 INFO  [com-helio-services-pipelines-draft-DraftUndoPanelNamingSpec-pekko.actor.default-dispatcher-4] o.a.pekko.actor.CoordinatedShutdown - Running CoordinatedShutdown with reason [ActorSystemTerminateReason]
[info] [hel1468-guard] ScalaTest summary: failed=5 aborted=0 unreadable=0
[info] Run completed in 3 seconds, 847 milliseconds.
[info] Total number of tests run: 7
[info] Suites: completed 1, aborted 0
[info] Tests: succeeded 2, failed 5, canceled 0, ignored 0, pending 0
[info] *** 5 TESTS FAILED ***
```

## Mutations (impl in place; logs mut1-4 in scratch/evidence)
- M1 id list instead of describeBlocking: cases a and c red.
- M3 name every alert rule: case f red.
- M2 pre-check dropped: all created-Output cases refused with PatchSetStale (pipeline id only, no panel id), so the pre-check is the message-bearing gate.
- M4 findById swapped for internal reads: case a (P3 named) red.

## Cycle 2
- Alert rules in (e), (f), (c) now come from `AlertRuleService.create` as the Output owner (asserting success); P3's grant is revoked with `PermissionService.revoke`. Case (b) keeps one raw rule row (owned by B on A's Output; no service path).
- M3 re-run against the service-created rule: case (f) still red (`mut3b.log`). M5 (drop the "and" strip): the new all-unreadable case red (`mut5.log`).
- Logs persisted via persist-evidence.sh under `.concertino/runs/HEL-1792/evidence/.concertino/scratch/HEL-1792/`.
- Spec split: setup moved to `testsupport/DraftUndoRlsFixture.scala`, tests stay in `DraftUndoPanelNamingSpec.scala` (196 lines).
