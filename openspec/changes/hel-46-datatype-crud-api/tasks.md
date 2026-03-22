## 1. DB Migration

- [ ] 1.1 Create `backend/src/main/resources/db/migration/V5__panel_type_binding.sql` — add nullable `type_id TEXT REFERENCES data_types(id) ON DELETE SET NULL` and `field_mapping TEXT` columns to `panels`

## 2. Domain Model

- [ ] 2.1 Add `typeId: Option[DataTypeId]` and `fieldMapping: Option[JsValue]` to `Panel` case class in `model.scala`

## 3. PanelRepository

- [ ] 3.1 Add `typeId: Option[String]` and `fieldMapping: Option[String]` to `PanelRow`
- [ ] 3.2 Add `typeId` and `fieldMapping` columns to `PanelTable`
- [ ] 3.3 Update `rowToDomain` to map new columns
- [ ] 3.4 Update `domainToRow` to map new fields
- [ ] 3.5 Add `updateTypeBinding(id: PanelId, typeId: Option[DataTypeId], fieldMapping: Option[JsValue], lastUpdated: Instant): Future[Option[Panel]]`

## 4. DataTypeRepository

- [ ] 4.1 Add `isBoundToAnyPanel(id: DataTypeId): Future[Boolean]` using a count query against `panels.type_id`

## 5. JSON Protocols

- [ ] 5.1 Add `DataFieldResponse`, `DataTypeResponse`, `DataTypesResponse`, `DataSourceResponse`, `DataSourcesResponse` response case classes to `JsonProtocols.scala`
- [ ] 5.2 Add `UpdateDataTypeRequest(name: Option[String], fields: Option[Vector[DataFieldPayload]])` and `DataFieldPayload` request case classes
- [ ] 5.3 Add Spray JSON formats for all new types
- [ ] 5.4 Extend `UpdatePanelRequest` to include `typeId: Option[Option[String]]` and `fieldMapping: Option[Option[JsValue]]`
- [ ] 5.5 Extend `PanelResponse` to include `typeId: Option[String]` and `fieldMapping: Option[JsValue]`

## 6. ApiRoutes

- [ ] 6.1 Inject `dataSourceRepo: DataSourceRepository` and `dataTypeRepo: DataTypeRepository` into `ApiRoutes`
- [ ] 6.2 Implement `GET /api/types` route
- [ ] 6.3 Implement `GET /api/types/:id` route
- [ ] 6.4 Implement `PATCH /api/types/:id` route (full name + fields update, version increment)
- [ ] 6.5 Implement `DELETE /api/types/:id` route (409 if bound, 404 if missing, 204 on success)
- [ ] 6.6 Implement `GET /api/data-sources` route
- [ ] 6.7 Extend `PATCH /api/panels/:id` handler to accept and persist `typeId` and `fieldMapping`

## 7. Wire repos in Main

- [ ] 7.1 Pass `dataSourceRepo` and `dataTypeRepo` to `ApiRoutes` constructor in `Main.scala`

## 8. Tests

- [ ] 8.1 Add `ApiRoutesSpec` tests: `GET /api/types` empty + populated, `GET /api/types/:id` found + 404, `PATCH /api/types/:id` update + 404, `DELETE /api/types/:id` success + 409 + 404
- [ ] 8.2 Add `ApiRoutesSpec` tests: `GET /api/data-sources` returns envelope
- [ ] 8.3 Add `ApiRoutesSpec` tests: `PATCH /api/panels/:id` binds typeId + fieldMapping, unbinds with null

## 9. Verification

- [ ] 9.1 Run `sbt test` in `backend/` — all tests pass
