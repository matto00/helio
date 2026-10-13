# SQL parity evidence (HEL-1433, D1/D2)

Base `f63ab8365`. Method: a throwaway, uncommitted probe test (`SqlParityProbe`, deleted before commit) rebuilt each
owner_id-referencing Slick expression from `TableQuery[DataSourceTable]` and printed `.result.statements` /
`.insertStatement` / `.delete.statements`. It ran once on base (before any edit) and once on head; the two outputs are
byte-identical (`diff` rc=0, both sha256 `1372246f852c2719a5d99c3b4e3e8ee5147fadf4a19024ba7e31e4804973aa31`).
Caveat: the probe restates each expression rather than invoking the private repository methods, so it proves the
expression/column-type combination, which is the only thing HEL-1433 changed. The NOBYPASSRLS repository specs below
cover the real call paths.

## Grep command and hit list

```
grep -rn "ownerId\|DataSourceRow" backend/src/main --include=*.scala | grep -i "DataSourceRepository\|WorkspaceTeardown\|PipelineCycleGuard\|RestSourceConnectorMigration"
```

Column/row users (by enclosing method, base line numbers) and verdict:

| Site | Query shape | Base vs head SQL |
|---|---|---|
| `DataSourceRepository.rowToDomain` (:50) | none (value mapping) | `UserId(row.ownerId.toString)`; `None` was unreachable on a NOT NULL column |
| `DataSourceRepository.domainToRow` (:114) | none (value mapping) | `UUID.fromString(ds.ownerId.value)`; empty owner now throws, deferred into the DBIO (D1) |
| `findAll` (:125, :126) | `owner_id = ?` [+ tag], count, sorted slice | identical (4 statements) |
| `findOwnedIds` (:145) | `select id ... where owner_id = ?` | identical |
| `findByIdOwned` (:182) | `*` select, `id = ? and owner_id = ?` | identical |
| `findByIdOwnedByInternal` (:193) | same | identical |
| `delete` (:265) | owned select + `delete ... where id and owner_id` | identical |
| `findAllRestApiRawInternal` (:315) | `*` select (type only) | identical; tuple type `(String, UUID, String, String)` |
| `writeExistingDatasetAction` (:411) | `select source_type, dataset_schema ... owner_id = ?` | identical |
| `ownedDatasetNameAction` (:529) | `select name ... owner_id = ? and source_type ...` | identical |
| `insert`, `insertDatasetSourceAction` (`table +=`) | `insert into data_sources (...) values (?,...)` | identical |
| `DataSourceTable.ownerId` (:1159), `DataSourceRow.ownerId` (:1144) | declaration | `column[UUID]` / `UUID` |
| `WorkspaceTeardownRepository.dependentConflicts` (:107), `planAndExecute` (:135) | `owner_id = ? and tag = ?` | identical |
| `PipelineCycleGuard.resolveDisplayNamesAction` (:45-47) | `select id, name, owner_id ... id in (...)` | identical; REAL caller edit `ownerId.exists(_.toString == actingUserId)` -> `ownerId.toString == actingUserId` (mutation-checked: flipping to `!=` turns `... naming a non-owned source by id` red) |
| `PipelineRepository` (`dataSourcesTable`) | joins on `id` only | untouched |

No query's SQL changed, so no new NOBYPASSRLS test was required beyond the existing ones.

## Probe output (head == base)

## findAll(tag) count
select count(1) from "data_sources" where ("owner_id" = '00000000-0000-0000-0000-000000000001') and ("tag" = 't')

## findAll(tag) slice
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where ("owner_id" = '00000000-0000-0000-0000-000000000001') and ("tag" = 't') order by "updated_at" desc limit 5 offset 0

## findAll(no tag) count
select count(1) from "data_sources" where "owner_id" = '00000000-0000-0000-0000-000000000001'

## findAll(no tag) slice
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where "owner_id" = '00000000-0000-0000-0000-000000000001' order by "updated_at" desc limit 5 offset 0

## findOwnedIds
select "id" from "data_sources" where "owner_id" = '00000000-0000-0000-0000-000000000001'

## findByIdOwned
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where ("id" = 'sid') and ("owner_id" = '00000000-0000-0000-0000-000000000001')

## findByIdOwnedByInternal
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where ("id" = 'sid') and ("owner_id" = '00000000-0000-0000-0000-000000000001')

## delete(owned select)
select "id" from "data_sources" where ("id" = 'sid') and ("owner_id" = '00000000-0000-0000-0000-000000000001')

## delete(owned delete)
delete from "data_sources" where ("data_sources"."id" = 'sid') and ("data_sources"."owner_id" = '00000000-0000-0000-0000-000000000001')

## findAllRestApiRawInternal
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where "source_type" = 'rest_api'

## findAllRestApiRawInternal map
select "id", "owner_id", "name", "config" from "data_sources" where "source_type" = 'rest_api'

## writeExistingDatasetAction
select "source_type", "dataset_schema" from "data_sources" where ("id" = 'sid') and ("owner_id" = '00000000-0000-0000-0000-000000000001')

## ownedDatasetNameAction
select "name" from "data_sources" where (("id" = 'sid') and ("owner_id" = '00000000-0000-0000-0000-000000000001')) and (("source_type" = 'dataset') or ("source_type" = 'static'))

## insert / insertDatasetSourceAction (+=)
insert into "data_sources" ("id","name","source_type","config","created_at","updated_at","owner_id","tag","inferred_schema")  values (?,?,?,?,?,?,?,?,?)

## findById (star select)
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where "id" = 'sid'

## teardown dependentConflicts / planAndExecute
select "id", "name", "source_type", "config", "created_at", "updated_at", "owner_id", "tag", "inferred_schema" from "data_sources" where ("owner_id" = '00000000-0000-0000-0000-000000000001') and ("tag" = 't')

## PipelineCycleGuard.resolveDisplayNamesAction
select "id", "name", "owner_id" from "data_sources" where "id" in ('a', 'b')

## Empty-owner grep (D1) and SQLState mapping

- `grep -rn 'UserId("")' backend/src/main` -> no hits. Owners reach `DataSource` from `AuthenticatedUser.id` or the pipeline
  owner (`newDatasetSourceAction(ownerId: String)`), never a literal empty string.
- No caller maps on the old SQLState: the only `PSQLException` handlers are `WorkspaceTeardownRepository:77` (`P0001`) and
  `PipelineService.classifyPsqlException` (message contains "violates foreign key / check constraint"); nothing matches
  `23502` or "null value in column". The new failure is an `IllegalArgumentException` (still a failed Future).
- The repository method is `insert` (not `create`). Pinned by `DataSourceRepositoryEmptyOwnerSpec` for both `insert` and
  `insertDatasetSource` (failed Future captured inside `noException should be thrownBy`, no row written); an eager-conversion
  mutation turns both red (see mutation-runs.md).

## Regression runs (all foreground, `nice -n 19`, sbt `testOnly` shards)

| Shard | Result |
|---|---|
| `sources.*`, `RestSourceConnectorMigrationSpec`, `*WorkspaceTeardown*`, `*UpsertTargetWritableRlsSpec`, `StoredObjectDeletionsMigrationSpec`, `RlsOwnerTablesSpec` (13 suites, incl. `DataSourceRepositoryApplyWriteBacksRlsSpec`, `DataSourceReferenceGuardNonSuperuserSpec`) | 177 passed, 0 failed |
| `*Cycle*`, `infrastructure.persistence.pipelines.*` (24 suites) | 294 passed |
| `com.helio.services.*` (206 suites) | 1991 passed, 4 canceled (pre-existing) |
| `com.helio.infrastructure.*` (97 suites) | 1041 passed |
| `com.helio.api.*` (156 suites) | 2239 passed |
| `com.helio.domain.*` + testkit (127 suites) | 2462 passed |
| `com.helio.spark.*`, `testsupport.*` (5 suites) | 42 passed |
