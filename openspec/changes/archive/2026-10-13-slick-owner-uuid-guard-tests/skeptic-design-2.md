## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `f63ab8365d2b0e6cac36154a83437b6d26b3a209` (branch `task/slick-owner-uuid-guard-tests/HEL-1433`, change dir untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/slick-owner-uuid-guard-tests/HEL-1433`.

### What I verified (with evidence)

The round-1 change requests, each checked against the source rather than against the orchestrator's account:

- **CR1 (D1, synchronous throw): addressed.**
  - design.md D1 now states as fact that `withUserContext` takes its action by value. It chooses option (b), deferring `domainToRow` into the DBIO chain, and pins that choice with a committed test (task 3.6) that must go red under an eager-conversion mutation.
  - Ground truth: `DataSourceRepository.scala:221-222` `insert` evaluates `table += domainToRow(source)` eagerly. `:370` is the first generator of `insertDatasetSourceAction`. That function is reached eagerly from `insertDatasetSource:349` and lazily from `PipelineStepRepository.scala:144` via `newDatasetSourceAction:470`.
  - These are the only two `domainToRow` call sites (grep). Deferring the conversion inside `insertDatasetSourceAction` covers both of its paths.
- **CR2 (D2, exhaustive site list): addressed.**
  - D2 now requires a grep-driven enumeration, with the command and hit list recorded in `sql-parity.md`.
  - I re-ran the grep at base. Every `ownerId` hit in `DataSourceRepository.scala` matches D2's list exactly: `:50, :114, :125, :126, :145, :182, :193, :265, :315, :411, :529, :1159`. The other hits at `:122-123, :143-144, :190-191` are method parameters or `UUID.fromString`, not column uses.
  - `DataSourceTable` consumers outside that file are `WorkspaceTeardownRepository:107,135`, `PipelineCycleGuard:44-47` and `PipelineRepository` (`:219`, `:234`, which join on `id` only). They also match the list.
  - `PipelineCycleGuard:47` `ownerId.exists(_.toString == actingUserId)` is named as a real caller edit (task 1.2b).
  - `DataSourceRow` is referenced only in `WorkspaceTeardownRepository` and `DataSourceRepository` (grep over `backend/src`), so the compile ripple is bounded.
- **CR3 (D5, StoredObjectDeletions reference): addressed.**
  - D5 names `StoredObjectDeletionsMigrationSpec.scala:18` and retargets it to `[[V119MigrationHarness]]` (task 3.5).
  - The remaining references point at content that stays in the kept-name class:
    - `RlsOwnerTablesSpec:282` and `RestSourceConnectorMigrationSpec:221` → the 23502/23503 test at V119 spec `:258`, in the "After V119" group.
    - The inventory doc at `:10` (table parse) and `:68` (user-delete outcomes) → the inventory test and the "After V119" group.
  - Outside archives there are no other references: `grep -rn V119OwnerFkMigrationSpec`, excluding `openspec/changes/archive` and this change.
- **Round-1 non-blocking notes:**
  - "four outcomes" at `:29` is now covered by D3.
  - The rule to run only embedded-Postgres specs, with no servers, while V119 is mutated is now explicit in D4.

Other checks:

- **Guard SQL** (`V119__data_sources_image_uploads_owner_fk.sql:52-63`): `root_refs`, `step_refs` (an IN list of four ops) and `panel_refs` are summed. D4's six mutations each disable exactly one reference kind. `LookupConfig` (`LookupStep.scala:16-17`) and `UnionConfig` (`UnionStep.scala:16`) both carry `secondaryInput: SecondaryInput`, so the join-shaped fixture is correct for the new tests.
- **Test count:** 2 cleanup + (4 existing abort + 2 new + 1 live-mention) + 7 "After V119" + 1 inventory = 17. This matches D5 and task 3.2.
- **Parked PRs:** #994 (63 files), #996 (26), #998 (28), #986 (32) and #999 (21) are all OPEN. None of their `gh pr diff --name-only` lists matches `DataSourceRepository|RestSourceConnector|V119|StoredObjectDeletions|PipelineCycleGuard|WorkspaceTeardown|RlsOwnerTables|user-reference-integrity|DbContext`. The plan never edits `docs/user-reference-inventory.md` or `RlsPolicyGuardSpec.scala`, and adds no migration. No collision.
- **Spec delta:** `openspec validate slick-owner-uuid-guard-tests --strict` reports the change as valid. The modified requirement keeps every base scenario and adds per-kind scenarios plus a live-reference negative.
- **Every AC maps to a task:**
  - AC1 → 1.1, 1.2b
  - AC2 → 1.3, 3.4, and 3.6 for the one intended failure-mode-preserving change
  - AC3 → 2.1, 2.2
  - AC4 → 3.2, 3.3
  - AC5 → 3.1, 3.5

  No scope drift.
- **No product call here.** Nothing to escalate.

### Verdict: CONFIRM

### Non-blocking notes

- D1 and task 3.6 call the method `create` (`:222`), but it is named `insert` (`DataSourceRepository.scala:221`). There is no `create` in this repository. The line number makes the target unambiguous; the executor should use `insert` in the test name and in `sql-parity.md`.
- Task 3.6 pins the deferral only on `insert`. The `insertDatasetSourceAction` deferral (reached eagerly from `insertDatasetSource:349`) has no test. A second assertion via `insertDatasetSource` with an empty owner would be cheap, but it is optional.
- The deferred failure becomes an `IllegalArgumentException` instead of today's PSQLException (23502/RLS). It is still a failed Future, and the executor's empty-owner grep should confirm that no caller maps that SQLState. Record that in `sql-parity.md`.
- The test in task 3.6 must actually detect a synchronous throw. It should capture the Future inside `noException should be thrownBy`, or an equivalent. Otherwise "red on an eager-conversion mutation" can pass for the wrong reason.
