# HEL-1531 mutation evidence (all shown red; each mutation reverted, tree green afterwards)

```
=== MUTATION M1 re-arm call removed
file: src/main/scala/com/helio/services/sources/StoredObjectDeletionService.scala
replace: 'rearmStuck(now).flatMap(_ => claimAndProcess(now))' -> 'claimAndProcess(now)'
cmd: sbt "testOnly com.helio.services.sources.StoredObjectDeletionRearmSpec"
[info] - should be re-armed and deleted one minute past the 24 h cool-down *** FAILED ***
[info] - should keep the object when the re-armed key is still referenced *** FAILED ***
[info] - should reach the cap again when the delete keeps failing, then wait out another cool-down *** FAILED ***
[info] - should be re-armed and deleted one minute past the 24 h cool-down *** FAILED ***
[info] - should keep the object when the re-armed key is still referenced *** FAILED ***
[info] - should reach the cap again when the delete keeps failing, then wait out another cool-down *** FAILED ***
[info] Tests: succeeded 6, failed 6, canceled 0, ignored 0, pending 0
[info] *** 6 TESTS FAILED ***
=== MUTATION M2 cutoff +1h
file: src/main/scala/com/helio/services/sources/StoredObjectDeletionService.scala
replace: 'now.minusSeconds(rearmAfterSeconds), maxAttempts' -> 'now.minusSeconds(rearmAfterSeconds - 3600), maxAttempts'
cmd: sbt "testOnly com.helio.services.sources.StoredObjectDeletionRearmSpec"
[info] - should stay stuck one minute inside the 24 h cool-down *** FAILED ***
[info] - should stay stuck one minute inside the 24 h cool-down *** FAILED ***
[info] Tests: succeeded 10, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
=== MUTATION M3 cutoff -1h
file: src/main/scala/com/helio/services/sources/StoredObjectDeletionService.scala
replace: 'now.minusSeconds(rearmAfterSeconds), maxAttempts' -> 'now.minusSeconds(rearmAfterSeconds + 3600), maxAttempts'
cmd: sbt "testOnly com.helio.services.sources.StoredObjectDeletionRearmSpec"
[info] - should be re-armed and deleted one minute past the 24 h cool-down *** FAILED ***
[info] - should keep the object when the re-armed key is still referenced *** FAILED ***
[info] - should be re-armed and deleted one minute past the 24 h cool-down *** FAILED ***
[info] - should keep the object when the re-armed key is still referenced *** FAILED ***
[info] Tests: succeeded 8, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
=== MUTATION M4 CASE replaced by claimed_at = NULL
file: src/main/scala/com/helio/infrastructure/persistence/sources/StoredObjectDeletionRepository.scala
replace: 'SET attempts    = 0,\n                 claimed_at  = CASE WHEN not_before IS NULL THEN NULL ELSE claimed_at END,' -> 'SET attempts    = 0,\n                 claimed_at  = NULL,'
cmd: sbt "testOnly com.helio.services.sources.StoredObjectDeletionRearmSpec"
[info] - should be re-armed and deleted one minute past the 24 h cool-down *** FAILED ***
[info] - should reset attempts and clear the lease on re-arm, keeping the row kind (claimed_at stays infinity for new-style) *** FAILED ***
[info] - should keep the object when the re-armed key is still referenced *** FAILED ***
[info] - should reach the cap again when the delete keeps failing, then wait out another cool-down *** FAILED ***
[info] Tests: succeeded 8, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
=== MUTATION M5 WHERE widened to (last_attempt_at IS NULL OR <= cutoff)
file: src/main/scala/com/helio/infrastructure/persistence/sources/StoredObjectDeletionRepository.scala
replace: 'AND last_attempt_at IS NOT NULL\n               AND last_attempt_at <= $cutoffTs' -> 'AND (last_attempt_at IS NULL OR last_attempt_at <= $cutoffTs)'
cmd: sbt "testOnly com.helio.services.sources.StoredObjectDeletionRearmSpec"
[info] - should stay stuck when it has no last attempt (hand SQL only), however old *** FAILED ***
[info] - should stay stuck when it has no last attempt (hand SQL only), however old *** FAILED ***
[info] Tests: succeeded 10, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
=== MUTATION M6 claim cap clause removed
file: src/main/scala/com/helio/infrastructure/persistence/sources/StoredObjectDeletionRepository.scala
replace: 'WHERE attempts < $maxAttempts\n                AND ((not_before' -> 'WHERE ((not_before'
cmd: sbt "testOnly com.helio.services.sources.StoredObjectDeletionServiceSpec com.helio.services.sources.FormAndConversationObjectDrainSpec"
[info] - should honour the attempt cap *** FAILED ***
[info] - should M5 skip a freshly leased row and a row inside its backoff, reclaim a stale lease, and honour the attempt cap *** FAILED ***
[info] Tests: succeeded 25, failed 2, canceled 0, ignored 0, pending 0
[info] *** 2 TESTS FAILED ***
=== MUTATION M7 stuck >= replaced by >
file: src/main/scala/com/helio/infrastructure/persistence/sources/StoredObjectDeletionRepository.scala
replace: 'count(*) FILTER (WHERE attempts >= $maxAttempts)' -> 'count(*) FILTER (WHERE attempts > $maxAttempts)'
cmd: sbt "testOnly com.helio.services.telemetry.AdminUsageTotalsSpec com.helio.infrastructure.persistence.StoredObjectDeletionsMigrationSpec"
[info] - should count queued and stuck stored-object deletions live: stuck exactly at the cap, never below, independent of days *** FAILED ***
[info] - should count the queue before anything is rolled up, and report zeros for an empty queue *** FAILED ***
[info] - should carry no key, source table or queue id in the serialised body *** FAILED ***
[info] - should HEL-1531 count the queue through the privileged pool (BYPASSRLS, migration grants only) and read zero on the app pool *** FAILED ***
[info] Tests: succeeded 10, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
=== MUTATION M8 counts read on the app pool (withUserContext with the system user id)
file: src/main/scala/com/helio/infrastructure/persistence/sources/StoredObjectDeletionRepository.scala
replace: '    ctx.withSystemContext(\n      sql"""SELECT count(*), count(*)' -> '    ctx.withUserContext("00000000-0000-0000-0000-000000000009")(\n      sql"""SELECT count(*), count(*)'
cmd: sbt "testOnly com.helio.services.telemetry.AdminUsageTotalsSpec com.helio.infrastructure.persistence.StoredObjectDeletionsMigrationSpec"
[info] - should HEL-1531 count the queue through the privileged pool (BYPASSRLS, migration grants only) and read zero on the app pool *** FAILED ***
[info] - should count queued and stuck stored-object deletions live: stuck exactly at the cap, never below, independent of days *** FAILED ***
[info] - should count the queue before anything is rolled up, and report zeros for an empty queue *** FAILED ***
[info] - should carry no key, source table or queue id in the serialised body *** FAILED ***
[info] Tests: succeeded 10, failed 4, canceled 0, ignored 0, pending 0
[info] *** 4 TESTS FAILED ***
=== MUTATION M9 pre-change schema (5.6): git show HEAD:schemas/admin/admin-usage-response.schema.json restored over the schema
cmd: sbt "testOnly com.helio.api.routes.admin.AdminUsageRoutesSpec com.helio.services.telemetry.AdminUsageTotalsSpec"
[info] - should report exact numbers for events written through POST /api/events and rolled up by the real rollup *** FAILED ***
[info] - should serialise to a body that validates against admin-usage-response.schema.json, nulls included *** FAILED ***
[info] Tests: succeeded 17, failed 2, canceled 0, ignored 0, pending 0
=== MUTATION M10 schema without the two required entries: (cd frontend; npx jest --maxWorkers=3 adminUsage.contract)
Tests:       1 failed, 4 passed, 5 total
=== MUTATION M11 <StorageCleanup/> line removed from AdminUsagePage.tsx: (cd frontend; npx jest --maxWorkers=3 AdminUsagePage)
Tests:       2 failed, 12 passed, 14 total
```

C1: StoredObjectDeletionsMigrationSpec "HEL-1531 count the queue through the privileged pool" asserts at read time
(false, true, "helio_privileged") = (rolsuper, rolbypassrls, current_user) on a NOSUPERUSER owner login with
helio_privileged BYPASSRLS and only migration grants; the same read on the app pool returns QueueCounts(0,0).
M8 (counts read on a non-bypass pool) and M7 (>= -> >) are red there. AdminUsageTotalsSpec runs on
ProductTelemetryDbHarness, which has the same role shape. ProductUsageRepositoryRoleSpec (privileged NOBYPASSRLS) still passes.

Visual check (6.3): real dev backend + vite via start-servers.sh, throwaway owner-tier @example.test users (deleted by
exact id via the e2e cleanup core), light and dark screenshots read: "Storage cleanup" section sits between the
all-time totals card and the stat row, two columns, no empty cell, consistent vertical spacing, both themes.
Shared dev DB queue was empty, so the page showed 0 / 0 (the counts come from the real endpoint).
