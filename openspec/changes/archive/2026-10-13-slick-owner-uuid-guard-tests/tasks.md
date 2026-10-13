## Standing Constraints

- [C1] Do not edit V119, add any migration, or touch any file in parked PRs #994/#996/#998/#986/#999 (incl. `docs/user-reference-inventory.md`, `RlsPolicyGuardSpec.scala`).
- [C2] Mutations of V119 are worktree-only, never committed; restore proven by `git diff --exit-code` + sha256.
- [C3] Test runs: foreground, `nice -n 19`, timeout 600000, ≤3 workers, targeted `testOnly` shards; report exactly what ran.
- [C4] Never run Flyway or start dev servers against the shared dev DB (head V131 via parked #994; V132 reserved by #1000). Embedded Postgres only. If a migration is ever needed: V133 and park the PR.

### Backend

## 1. Owner type

- [x] 1.1 `DataSourceTable.ownerId` → `column[UUID]`, `DataSourceRow.ownerId: UUID`, drop both fallbacks; verify `sbt Test/compile` succeeds
- [x] 1.2 Defer `domainToRow` into the DBIO at `create`/`insertDatasetSourceAction` (D1); grep empty-owner construction into `sql-parity.md`
- [x] 1.2b Update `PipelineCycleGuard.resolveDisplayNamesAction` for the non-optional owner; verify compile
- [x] 1.3 Grep every owner reference (D2 list), capture base vs head SQL per method; verify byte-identical in `sql-parity.md`

## 2. Ownerless branch

- [x] 2.1 `findAllRestApiRawInternal` returns non-optional owner; remove `case None` + header lines + stale doc; verify compile
- [x] 2.2 Update `RestSourceConnectorMigrationSpec` comment (221-223) and collapse `seedLegacyRestSource`'s Option; verify spec green

### Tests

## 3. Split and guard tests

- [x] 3.1 Extract `V119MigrationHarness`; create `V119OwnerFkCleanupSpec`, `V119OwnerFkGuardSpec`; slim `V119OwnerFkMigrationSpec`; verify old test names ⊆ new
- [x] 3.2 Add lookup and union abort tests and extend the live-mention test; verify all three V119 specs green (17 tests)
- [x] 3.3 Run the six-mutation matrix (D4), record red tests per mutation in `mutation-runs.md`, restore and prove V119 unchanged
- [x] 3.4 Run the D2 regression set (NOBYPASSRLS repository specs, `DataSourceRepository*Spec`, `RestSourceConnectorMigrationSpec`, `WorkspaceTeardown*Spec`); verify green
- [x] 3.5 Retarget `StoredObjectDeletionsMigrationSpec:18` to the harness; grep every `V119OwnerFkMigrationSpec` reference and confirm each is true
- [x] 3.6 Add a test: `create` with an empty owner returns a failed Future, no synchronous throw, no row (D1); verify red on an eager-conversion mutation
