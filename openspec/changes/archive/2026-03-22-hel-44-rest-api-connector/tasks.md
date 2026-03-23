## 1. Domain — Auth config model

- [x] 1.1 Add `RestApiAuth` sealed trait (subtypes: `NoAuth`, `BearerAuth(token)`, `ApiKeyAuth(name, value, in)`) to `model.scala`
- [x] 1.2 Add `ApiKeyPlacement` enum (`Header`, `Query`) to `model.scala`
- [x] 1.3 Add `RestApiConfig(url, method, auth, headers)` case class to `model.scala`

## 2. RestApiConnector service

- [x] 2.1 Create `backend/src/main/scala/com/helio/domain/RestApiConnector.scala` as a class taking `ActorSystem`
- [x] 2.2 Implement `fetch(config: RestApiConfig): Future[Either[String, JsValue]]` — performs the HTTP request with auth injection and returns the parsed JSON body or an error message
- [x] 2.3 Implement bearer auth injection (`Authorization: Bearer <token>` header)
- [x] 2.4 Implement api_key header injection
- [x] 2.5 Implement api_key query param injection (appends to URL)
- [x] 2.6 Implement `toRows(json: JsValue): Vector[JsValue]` — wraps JsObject in array, returns JsArray as-is
- [x] 2.7 Apply 10s connection timeout and 30s request timeout via Akka HTTP client settings

## 3. DataSourceRepository — update method

- [x] 3.1 Add `update(source: DataSource): Future[Option[DataSource]]` to `DataSourceRepository` (updates `name`, `config`, `updatedAt`; returns `None` if not found)

## 4. JSON Protocols

- [x] 4.1 Add `CreateSourceRequest(name, sourceType, config)` and `CreateSourceResponse(source, dataType, fetchError)` case classes to `JsonProtocols.scala`
- [x] 4.2 Add `PreviewSourceResponse(rows)` case class
- [x] 4.3 Add Spray JSON formats for all new types
- [x] 4.4 Add `RestApiConfigPayload` and `RestApiAuthPayload` case classes with formats for deserialization (used to parse the `config` field)

## 5. ApiRoutes — new source routes

- [x] 5.1 Add `POST /api/sources` route: parse request, insert DataSource, attempt fetch+inference, conditionally insert DataType, return `CreateSourceResponse`
- [x] 5.2 Add `POST /api/sources/:id/refresh` route: find DataSource (404 if missing), fetch+infer (502 on fetch failure), update-or-insert DataType, return updated DataType
- [x] 5.3 Add `GET /api/sources/:id/preview` route: find DataSource (404 if missing), fetch (502 on failure), call `toRows`, return first 10 as `PreviewSourceResponse`

## 6. Tests

- [x] 6.1 `DataSourceRepositorySpec`: add test for `update` — returns updated entity; returns `None` for unknown id
- [x] 6.2 `ApiRoutesSpec`: `POST /api/sources` with a mock-able connector — test 201 + DataType registered (use a local test HTTP server or stub)
- [x] 6.3 `ApiRoutesSpec`: `POST /api/sources` where fetch fails → 201 + `fetchError` set, no DataType
- [x] 6.4 `ApiRoutesSpec`: `POST /api/sources/:id/refresh` success → 200 + version incremented
- [x] 6.5 `ApiRoutesSpec`: `POST /api/sources/:id/refresh` for unknown id → 404
- [x] 6.6 `ApiRoutesSpec`: `GET /api/sources/:id/preview` returns rows capped at 10
- [x] 6.7 `ApiRoutesSpec`: `GET /api/sources/:id/preview` for unknown id → 404

## 7. Verification

- [x] 7.1 Run `sbt test` in `backend/` — all tests pass
