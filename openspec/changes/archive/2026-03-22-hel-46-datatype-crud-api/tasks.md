## 1. DB Migration

- [x] 1.1 Create `backend/src/main/resources/db/migration/V5__panel_type_binding.sql` — add nullable `type_id TEXT REFERENCES data_types(id) ON DELETE SET NULL` and `field_mapping TEXT` columns to `panels`

## 2. Domain Model

- [x] 2.1 Add `typeId: Option[DataTypeId]` and `fieldMapping: Option[JsValue]` to `Panel` case class in `model.scala`

## 3. PanelRepository

- [x] 3.1 Add `typeId: Option[String]` and `fieldMapping: Option[String]` to `PanelRow`
- [x] 3.2 Add `typeId` and `fieldMapping` columns to `PanelTable`
- [x] 3.3 Update `rowToDomain` to map new columns
- [x] 3.4 Update `domainToRow` to map new fields
- [x] 3.5 Add `updateTypeBinding(id: PanelId, typeId: Option[DataTypeId], fieldMapping: Option[JsValue], lastUpdated: Instant): Future[Option[Panel]]`

## 4. DataTypeRepository

- [x] 4.1 Add `isBoundToAnyPanel(id: DataTypeId): Future[Boolean]` using a count query against `panels.type_id`

## 5. JSON Protocols

- [x] 5.1 Add `DataFieldResponse`, `DataTypeResponse`, `DataTypesResponse`, `DataSourceResponse`, `DataSourcesResponse` response case classes to `JsonProtocols.scala`
- [x] 5.2 Add `UpdateDataTypeRequest(name: Option[String], fields: Option[Vector[DataFieldPayload]])` and `DataFieldPayload` request case classes
- [x] 5.3 Add Spray JSON formats for all new types
- [x] 5.4 Extend `UpdatePanelRequest` to include `typeId: Option[Option[String]]` and `fieldMapping: Option[Option[JsValue]]`
- [x] 5.5 Extend `PanelResponse` to include `typeId: Option[String]` and `fieldMapping: Option[JsValue]`

## 6. ApiRoutes

- [x] 6.1 Inject `dataSourceRepo: DataSourceRepository` and `dataTypeRepo: DataTypeRepository` into `ApiRoutes`
- [x] 6.2 Implement `GET /api/types` route
- [x] 6.3 Implement `GET /api/types/:id` route
- [x] 6.4 Implement `PATCH /api/types/:id` route (full name + fields update, version increment)
- [x] 6.5 Implement `DELETE /api/types/:id` route (409 if bound, 404 if missing, 204 on success)
- [x] 6.6 Implement `GET /api/data-sources` route
- [x] 6.7 Extend `PATCH /api/panels/:id` handler to accept and persist `typeId` and `fieldMapping`

## 7. Wire repos in Main

- [x] 7.1 Pass `dataSourceRepo` and `dataTypeRepo` to `ApiRoutes` constructor in `Main.scala`

## 8. Tests

- [x] 8.1 Add `ApiRoutesSpec` tests: `GET /api/types` empty + populated, `GET /api/types/:id` found + 404, `PATCH /api/types/:id` update + 404, `DELETE /api/types/:id` success + 409 + 404
- [x] 8.2 Add `ApiRoutesSpec` tests: `GET /api/data-sources` returns envelope
- [x] 8.3 Add `ApiRoutesSpec` tests: `PATCH /api/panels/:id` binds typeId + fieldMapping, unbinds with null

## 9. Verification

- [x] 9.1 Run `sbt test` in `backend/` — all tests pass
