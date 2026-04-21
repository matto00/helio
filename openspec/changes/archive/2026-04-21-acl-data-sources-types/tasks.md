## 1. Backend — Database Migrations

- [x] 1.1 Add `V14__data_sources_owner.sql`: `ALTER TABLE data_sources ADD COLUMN owner_id UUID`
- [x] 1.2 Add `V15__data_types_owner.sql`: `ALTER TABLE data_types ADD COLUMN owner_id UUID`

## 2. Backend — Domain Model

- [x] 2.1 Add `ownerId: UserId` field to `DataSource` case class in `model.scala`
- [x] 2.2 Add `ownerId: UserId` field to `DataType` case class in `model.scala`

## 3. Backend — Repositories

- [x] 3.1 Add `owner_id` column to `DataSourceTable` Slick mapping and `DataSourceRow`
- [x] 3.2 Update `rowToDomain` / `domainToRow` in `DataSourceRepository` for `ownerId`
- [x] 3.3 Change `DataSourceRepository.findAll()` to `findAll(ownerId: UserId)` — filter by owner
- [x] 3.4 Change `DataSourceRepository.findById` to accept `ownerId: UserId` — return None on mismatch
- [x] 3.5 Add `owner_id` column to `DataTypeTable` Slick mapping and `DataTypeRow`
- [x] 3.6 Update `rowToDomain` / `domainToRow` in `DataTypeRepository` for `ownerId`
- [x] 3.7 Change `DataTypeRepository.findAll()` to `findAll(ownerId: UserId)` — filter by owner
- [x] 3.8 Change `DataTypeRepository.findBySourceId` to accept `ownerId: UserId` — filter by owner
- [x] 3.9 Add owner-scoped `findById(id, ownerId)` overload to `DataTypeRepository` (returns None on mismatch)

## 4. Backend — Routes

- [x] 4.1 Add `user: AuthenticatedUser` constructor param to `DataSourceRoutes`
- [x] 4.2 Pass `user` to all `dataSourceRepo` calls (`findAll`, `findById`, `insert`); set `ownerId` on new sources
- [x] 4.3 Apply `AclDirective.authorizeResource` on `DELETE /data-sources/:id`, `GET /:id/preview`, `POST /:id/refresh`
- [x] 4.4 Add `user: AuthenticatedUser` constructor param to `DataTypeRoutes`
- [x] 4.5 Pass `user` to `dataTypeRepo.findAll`; set `ownerId` on new types created via `DataSourceRoutes`
- [x] 4.6 Apply `AclDirective.authorizeResource` on `PATCH /types/:id` and `DELETE /types/:id`
- [x] 4.7 Update `ApiRoutes` to pass `authenticatedUser` when instantiating `DataTypeRoutes`, `DataSourceRoutes`, `SourceRoutes`
- [x] 4.8 Register `DataSource` and `DataType` resolvers in `ApiRoutes` for the ACL directive

## 5. Backend — Cross-user Panel Type Binding

- [x] 5.1 Update `PanelRepository` panel read path: use owner-scoped `DataTypeRepository.findById` to null-out cross-user typeId on response construction (or handle in `PanelRoutes` response mapping)

## 6. Backend — DemoData

- [x] 6.1 Update `DemoData.scala` to pass the demo user's `UserId` as `ownerId` when constructing `DataSource` and `DataType` seed values

## 7. Backend — Tests

- [x] 7.1 Add `DataSourceRepository` tests: `findAll` filtered by owner, `findById` returns None for wrong owner
- [x] 7.2 Add `DataTypeRepository` tests: `findAll` filtered by owner, `findById` owner-scoped overload
- [x] 7.3 Add `DataSourceRoutes` tests: `GET /data-sources` scoped, `DELETE` 403 for non-owner
- [x] 7.4 Add `DataTypeRoutes` tests: `GET /types` scoped, `PATCH` and `DELETE` 403 for non-owner
- [x] 7.5 Add cross-user type binding test: panel with foreign typeId reads as typeId=null
