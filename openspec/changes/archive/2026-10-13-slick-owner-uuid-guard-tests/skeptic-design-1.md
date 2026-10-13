## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `f63ab8365d2b0e6cac36154a83437b6d26b3a209` (branch `task/slick-owner-uuid-guard-tests/HEL-1433`, change dir untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/slick-owner-uuid-guard-tests/HEL-1433`.

### What I verified (with evidence)

Citations that hold:
- `DataSourceRepository.scala:1159` `column[Option[UUID]]("owner_id")`; `:50` `getOrElse(UserId(""))`; `:114` empty-to-None row builder; `:313-315` `findAllRestApiRawInternal` returns `Option[UUID]`. Correct.
- No V120..V130 migration touches `data_sources.owner_id` (grepped every one that mentions `data_sources`). Correct.
- `RestSourceConnectorMigration.scala`: header lines 32-33 and `case None` at 114-118; `findAllRestApiRawInternal` has one caller (`:94`). `RestSourceConnectorMigrationSpec.scala:221-223` says "The defensive branch in the migration is unchanged". `seedLegacyRestSource` (`:138`) has 5 callers and all pass `Some(owner)`, so collapsing it is safe. Correct.
- `V119OwnerFkMigrationSpec.scala` is 414 lines with 15 tests: 2 cleanup, 4 abort plus 1 live-mention, 7 "After V119", and 1 inventory. 15 → 17 is the right count. The harness ends around line 155 and `expectGuardAbort` is at `:143`. Correct.
- V119 guard SQL (lines 51-66): `s.op IN ('join','lookup','union','upsertsource') AND strpos(s.config, t) > 0`, with `root_refs` and `panel_refs` counted separately and summed. The six mutations in D4 each disable exactly one clause. The existing join test (`:211`) uses `{"secondaryInput":{"kind":"source","dataSourceId":...}}`, which matches `SecondaryInput.scala:29`. `LookupStep.scala:16` and `UnionStep.scala:16` exist. Correct.
- Doc references at `docs/user-reference-inventory.md:10,68`, `RlsOwnerTablesSpec.scala:282` and `RestSourceConnectorMigrationSpec.scala:221`. Correct.
- Parked PRs: `gh pr diff --name-only` for #994 (63 files), #996 (26), #998 (28), #986 (32) and #999 (21), all OPEN. None of them contains `DataSourceRepository`, `RestSourceConnector*`, `V119*`, `WorkspaceTeardown*`, `PipelineCycleGuard`, `StoredObjectDeletions*`, `RlsOwnerTables*`, `SourceService`/`DataSourceService` or `user-reference-integrity`. #994 does contain `docs/user-reference-inventory.md`, `RlsPolicyGuardSpec.scala` and `V131`, and the plan leaves all three alone. No collision.
- Spec delta: diffed it against the base requirement. It is the same requirement plus one sentence and six scenarios, and no base scenario was dropped. `openspec validate slick-owner-uuid-guard-tests --strict` → "is valid".
- The ticket's ACs map to tasks as follows: AC1→1.1, AC2→1.3/3.4, AC3→2.1/2.2, AC4→3.2/3.3, AC5→3.1/3.5. Nothing is left uncovered and nothing is out of scope.

Claims that do not hold up:
- **D1's call-site audit premise is false, and no outcome is specified for it.** `DbContext.scala:50`: `withUserContext[R](userId: String)(action: DBIO[R])` takes the action by value. So `DataSourceRepository.scala:222` `ctx.withUserContext(user.id.value)(table += domainToRow(source))` evaluates `domainToRow` synchronously, before any Future exists. The same holds for `:349` → `insertDatasetSourceAction` → `:370` `table += domainToRow(...)` (the first generator, built eagerly). Today an empty owner becomes a NULL insert and fails inside the Future with 23502. After the change, `UUID.fromString("")` throws `IllegalArgumentException` synchronously out of a `Future`-returning `insert`. D1 tells the executor to "verify every call site ... runs inside a Future transformation", and the answer is already known to be no. The design never says what to do in that case, which leaves an implementation decision open in a ticket whose AC2 requires behaviour preservation.
- **D2's query list is incomplete.** AC2 requires parity for *every* `owner_id`-referencing query. D2 lists "at least" findAll, findOwnedIds, findByIdOwned, findAllRestApiRawInternal, insert/update and WorkspaceTeardown's two filters. Grepping `ownerId` shows more:
  - `DataSourceRepository.scala:193` (`findByIdOwnedByInternal`)
  - `:265` (the RLS-backstop owned filter)
  - `:411` (the schema read)
  - `:529` (the dataset/static owned filter)
  - `PipelineCycleGuard.scala:45` (projects `d.ownerId`)

  The design calls `PipelineCycleGuard` merely "compile-checked", but `:47` `ownerId.exists(_.toString == actingUserId)` will not compile against `UUID` and needs a real edit. Its projection query belongs in the parity set.
- **D5 says keeping the class name makes "every existing reference stay true". It does not.** `StoredObjectDeletionsMigrationSpec.scala:18` cites `[[V119OwnerFkMigrationSpec]]` for "prod's Flyway role shape". D5 moves that role and template setup into `V119MigrationHarness`, so after the split the reference points at the wrong file. Task 3.5's grep would probably catch it, but the design states the opposite as settled fact.

### Verdict: REFUTE

### Change Requests

1. **design.md D1: decide the synchronous-throw case.** State as fact that `insert` (`:222`) and `insertDatasetSourceAction` (`:370`, reached from `:349` and from `newDatasetSourceAction` `:470`) build the row synchronously. Then pick one option:
   - (a) **Recommended:** keep the eager call and record why an empty owner cannot reach it. Every `insert` caller passes a source built from `AuthenticatedUser.id`, `newDatasetSourceAction` gets the pipeline owner, and a non-empty malformed id already throws synchronously today. The executor greps to confirm that and records it in `sql-parity.md`.
   - (b) Defer the conversion into the DBIO, e.g. `DBIO.from(Future.fromTry(Try(domainToRow(..))))` or similar, so the error stays a failed Future.

   Either way, task 1.2's acceptance signal should name the expected finding instead of "verify".
2. **design.md D2 and task 1.3: make the parity set exhaustive.** Replace "at least" with a requirement to enumerate mechanically: grep `ownerId` across `DataSourceRepository.scala` and every `DataSourceTable` consumer (`WorkspaceTeardownRepository`, `PipelineCycleGuard`, `PipelineRepository`). Add the sites listed above (`:193`, `:265`, `:411`, `:529`, `PipelineCycleGuard:45`) and record each site in `sql-parity.md` with its base/head statement. Also note that `PipelineCycleGuard:47` needs a code edit (`ownerId.toString == actingUserId`). It is behaviour-identical for a NOT NULL column, but it is a caller change and belongs in `files-modified.md`.
3. **design.md D5: name `StoredObjectDeletionsMigrationSpec.scala:18`.** Its reference is about the role shape, which moves to `V119MigrationHarness`, so retarget that scaladoc link to the harness. This file is in no parked PR. Remove the claim that the kept class name keeps every reference true.

### Non-blocking notes

- `RestSourceConnectorMigration.scala:29` says "exactly one of four outcomes". D3's "renumber" should also say *three*.
- During task 3.3, while V119 is mutated in the worktree, run only the embedded-Postgres V119 specs. Do not run anything that applies Flyway to the shared dev DB, and do not start servers, until the restore is proven: a mismatched V119 checksum fails validation there (see the MEMORY hazard on shared dev DB Flyway collisions). The task order (3.3 before 3.4) already allows this. Making it explicit costs nothing.
- `findByIdOwned` in D2 most likely means the method at `:180-182`. Use exact method names in `sql-parity.md`.
- The ticket has no product call to make. Nothing to escalate.
