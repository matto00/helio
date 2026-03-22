## 1. DB Migration

- [x] 1.1 Create `backend/src/main/resources/db/migration/V4__data_sources_and_types.sql` with `data_sources` table (id, name, source_type TEXT with CHECK constraint, config TEXT, created_at, updated_at)
- [x] 1.2 Add `data_types` table (id, source_id nullable FK → data_sources ON DELETE SET NULL, name, fields TEXT, version INT default 1, created_at, updated_at) in the same migration
- [x] 1.3 Add indexes: `data_types_source_id_idx` on `data_types(source_id)`

## 2. Domain Models

- [x] 2.1 Add `DataSourceId`, `DataTypeId` value-class wrappers to `model.scala`
- [x] 2.2 Add `SourceType` sealed trait (`RestApi`, `Csv`, `Static`) with `fromString`/`asString` to `model.scala`
- [x] 2.3 Add `DataSource` case class (id, name, sourceType, config as `spray.json.JsValue`, createdAt, updatedAt) to `model.scala`
- [x] 2.4 Add `DataField` case class (name, displayName, dataType as String, nullable as Boolean) to `model.scala`
- [x] 2.5 Add `DataType` case class (id, sourceId as `Option[DataSourceId]`, name, fields as `Vector[DataField]`, version, createdAt, updatedAt) to `model.scala`

## 3. DataSourceRepository

- [x] 3.1 Create `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` with `DataSourceRow`, `DataSourceTable`, and class `DataSourceRepository(db)(implicit ec)`
- [x] 3.2 Implement `findAll(): Future[Vector[DataSource]]`
- [x] 3.3 Implement `findById(id: DataSourceId): Future[Option[DataSource]]`
- [x] 3.4 Implement `insert(source: DataSource): Future[DataSource]`
- [x] 3.5 Implement `delete(id: DataSourceId): Future[Boolean]`

## 4. DataTypeRepository

- [x] 4.1 Create `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala` with `DataTypeRow`, `DataTypeTable`, and class `DataTypeRepository(db)(implicit ec)`
- [x] 4.2 Implement `findAll(): Future[Vector[DataType]]`
- [x] 4.3 Implement `findBySourceId(id: DataSourceId): Future[Vector[DataType]]`
- [x] 4.4 Implement `findById(id: DataTypeId): Future[Option[DataType]]`
- [x] 4.5 Implement `insert(dt: DataType): Future[DataType]` — always persists with `version = 1`
- [x] 4.6 Implement `update(dt: DataType): Future[Option[DataType]]` — increments `version` in DB
- [x] 4.7 Implement `delete(id: DataTypeId): Future[Boolean]`

## 5. Wiring

- [x] 5.1 Instantiate `DataSourceRepository` and `DataTypeRepository` in `Main.scala`

## 6. JSON Protocols

- [x] 6.1 Add Spray JSON formats for `DataField`, `DataSource`, `DataType`, `SourceType` to `JsonProtocols.scala`

## 7. Tests

- [x] 7.1 Create `backend/src/test/scala/com/helio/infrastructure/DataSourceRepositorySpec.scala` using embedded Postgres — test insert/findById, findAll, delete
- [x] 7.2 Create `backend/src/test/scala/com/helio/infrastructure/DataTypeRepositorySpec.scala` — test insert sets version=1, findById, findBySourceId, update increments version, delete, source deletion orphans type (sourceId becomes None)

## 8. Verification

- [x] 8.1 Run `sbt test` in `backend/` — all tests pass
