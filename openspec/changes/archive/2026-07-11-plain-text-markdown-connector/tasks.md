## 1. Backend: domain + persistence

- [x] 1.1 Add `TextSourceConfig(path, sourceUrl: Option[String])` and `TextSource` case class to `domain/DataSource.scala`; add `DataSourceKind.Text = "text"` to `All`.
- [x] 1.2 Add Flyway migration (next `V` after `V46`) dropping/recreating `data_sources_source_type_check` to include `'text'`.
- [x] 1.3 Add `DataSourceConfigCodec.decodeText`/`encodeText` for `TextSourceConfig` (path + optional sourceUrl).
- [x] 1.4 Wire `TextSource` into `DataSourceRepository.rowToDomain`/`domainToRow`/`update`'s closed matches.
- [x] 1.5 Add a `TextSource` case to `DataSourceService.update`'s separate closed match (lines 148-153, missed in round 1) — without it, `PATCH /api/data-sources/:id` on a text source throws an uncaught `MatchError` (500).
- [x] 1.6 Add `ServiceError.PayloadTooLarge(message)` and wire it into `ServiceResponse.completeError` as `StatusCodes.RequestEntityTooLarge` (413).

## 2. Backend: content connector shared helpers

- [x] 2.1 Create `services/ContentSourceSupport.scala` with `metadataFields(contentFieldType, filename, sizeBytes): Vector[DataField]`.
- [x] 2.2 Add `ContentSourceSupport.fetchUrl(url)(implicit system): Future[Either[String, Array[Byte]]]` (raw-bytes GET, `RestApiConnector`'s pooled-connection settings pattern).
- [x] 2.3 Add extension validation helper (`.txt`/`.md` only) usable from both upload and URL paths.

## 3. Backend: service + wire protocol

- [x] 3.1 Add `TextSourceConfigPayload`, `TextSourceResponse`, `TextSourceUrlRequest` (`{name, type, config: {url}}`) to `DataSourceProtocol`; extend the `DataSourceResponse` discriminated-union format for `type = "text"`.
- [x] 3.2 Add `DataSourceService.createTextUpload(name, bytes, filename, user)`/`createTextUrl(name, url, user)`, sharing a private `ingestText` (extension + size + UTF-8 validation, `FileSystem` write at `text/<sourceId>.<ext>`, `DataType` registration via `ContentSourceSupport.metadataFields(StringBodyType, ...)`).
- [x] 3.3 Extend `DataSourceService.refresh` with a `TextSource` case: re-read stored file if `sourceUrl` is `None`, re-fetch + overwrite if `Some`.
- [x] 3.4 Extend `DataSourceService.delete` to call `FileSystem.delete` for `TextSource` (mirrors `CsvSource`).
- [x] 3.5 Read `TEXT_MAX_FILE_SIZE_BYTES` (default 10485760); enforce in `ingestText` for both upload-bytes and URL-fetch byte-count, returning `ServiceError.PayloadTooLarge` (task 1.6).

## 4. Backend: routes

- [x] 4.1 Replace `createCsvRoute` with a single `createMultipartUploadRoute`: collect parts once (existing `Sink.seq`), read optional `type` part (default `"csv"`), branch internally (no second `entity(as[Multipart.FormData])`) to CSV or `createTextUpload` logic.
- [x] 4.2 Replace `createStaticRoute`'s `entity(as[StaticDataSourceRequest])` with `entity(as[JsValue])`, inspect `type` once, `convertTo[StaticDataSourceRequest]` or `convertTo[TextSourceUrlRequest]` — mirrors `SourceRoutes.scala`'s REST/SQL dispatch (two sibling JSON routes can't safely re-unmarshal one request).

## 5. Backend: pipeline row-loading

- [x] 5.1 Add a `case t: TextSource` to `InProcessPipelineEngine.loadRows`: read stored file, decode UTF-8, return one-row `Seq(Map("content" -> ..., "filename" -> ..., "sizeBytes" -> ...))`.

## 6. Frontend

- [x] 6.1 Add `"text"` to the `SourceType` union in `AddSourceModal.tsx`; add a toggle entry in `SourceTypeToggle.tsx`.
- [x] 6.2 Add `TextSourceForm.tsx` supporting both file-picker and URL-entry sub-modes (mirrors `CsvForm.tsx`/`RestApiForm.tsx`).
- [x] 6.3 Add `createTextSourceUpload`/`createTextSourceUrl` to `features/sources/services/dataSourceService.ts`.
- [x] 6.4 Wire the create path in `AddSourceModal.tsx` for the new `"text"` source type.
- [x] 6.5 Add `TextSourceConfig`/response types to `features/sources/types/dataSource.ts`.

## 7. Tests

- [x] 7.1 Backend: `DataSourceService` tests for `createTextUpload`/`createTextUrl` (valid `.txt`/`.md`, unsupported extension, oversized → `PayloadTooLarge`/413, non-UTF-8, refresh both variants, delete, `update`/rename on `TextSource`).
- [x] 7.2 Backend: `DataSourceRoutes` tests — multipart `type=text` upload, JSON URL creation, and regressions confirming CSV upload (no `type` part) and Static creation still work unchanged.
- [x] 7.3 Backend: `InProcessPipelineEngine.loadRows` test for `TextSource` (single row, correct keys/values).
- [x] 7.4 Backend: `ContentSourceSupport.metadataFields` unit test (field names/types per `DataFieldType`).
- [x] 7.5 Frontend: `AddSourceModal`/`TextSourceForm` tests for upload and URL sub-modes.

## 8. Cycle-2 fix: SSRF guard on `ContentSourceSupport.fetchUrl` (orchestrator follow-up)

- [x] 8.1 Add `ContentSourceSupport.validateUrl`/`isBlockedAddress`: reject non-`http`/`https` schemes, missing host, DNS-resolution failure, and hosts resolving to loopback/link-local (incl. `169.254.0.0/16`)/RFC1918-private/unique-local-IPv6 (`fc00::/7`)/any-local/multicast addresses — before any request is issued.
- [x] 8.2 Wire the guard into `fetchUrl`; confirm redirects are never auto-followed (Pekko HTTP's low-level `singleRequest` doesn't follow 3xx) so a redirect to an internal address surfaces as a blocked non-success response rather than being chased (closes the TOCTOU gap without a second validation pass).
- [x] 8.3 Replace the error-path's `entity.data.utf8String` (upstream body echo) with a generic `Upstream returned HTTP <status>` message.
- [x] 8.4 Add a test-injectable `resolveHost` parameter (default: real DNS) to `fetchUrl`, `DataSourceService`, and `ApiRoutes` — production wiring (`Main.scala`) never overrides it; tests use it only to unblock a known local-test-server hostname, not to bypass the guard for arbitrary hosts.
- [x] 8.5 Tests: `ContentSourceSupportSpec` (pure `isBlockedAddress`/`validateUrl` coverage for all denylist categories + scheme/DNS-failure rejection; `fetchUrl`-level tests for default-resolver-blocks-loopback, permitted-resolver-succeeds, redirect-to-internal-not-followed, no-body-echo-on-error); `DataSourceServiceSpec`/`DataSourceRoutesSpec` new tests proving literal blocked addresses/schemes are still rejected through the full service/route path even with the test resolver override in place.

## 9. Cycle-3 fix: close DNS-rebinding TOCTOU in `ContentSourceSupport.fetchUrl` (skeptic final-gate round 1)

- [x] 9.1 Factor `validateUrl`'s host-resolution + denylist check into a private `resolveValidated(url, resolveHost, isBlocked): Either[String, InetAddress]` that returns the validated address (not just `Unit`), shared by `validateUrl` (still `Either[String, Unit]`, unchanged public contract) and `fetchUrl`.
- [x] 9.2 Add a private `pinnedTransport(pinnedAddress): ClientTransport` built via `ClientTransport.withCustomResolver`, always returning an already-resolved `InetSocketAddress(pinnedAddress, port)` regardless of the host/port Pekko's pool would otherwise resolve — apply it via `ConnectionPoolSettings.withTransport(...)` in `fetchUrl` so the actual TCP connection is forced to the exact address `resolveValidated` already checked (the `Host` header / TLS SNI stay derived from the request's `Uri`, untouched by the transport).
- [x] 9.3 Add a hostname-keyed `isBlocked: (String, InetAddress) => Boolean` parameter to `validateUrl`/`fetchUrl` (default: host-agnostic `isBlockedAddress`) — the seam that replaces the old "resolver that lies about the resolved address" test pattern, which stopped working once the real connection is pinned to whatever `resolveHost` returns.
- [x] 9.4 Thread `isBlocked` through `DataSourceService` (new constructor param, default `ContentSourceSupport.isBlockedAddress`, forwarded to both `fetchUrl` call sites) and `ApiRoutes` (new `dataSourceUrlIsBlocked` param, never overridden by `Main.scala`).
- [x] 9.5 Restructure `ContentSourceSupportSpec`/`DataSourceServiceSpec`/`DataSourceRoutesSpec`'s test resolvers: drop the "lie about the resolved address" pattern (no longer needed — real DNS already resolves `"localhost"` correctly), and admit that one hostname past the denylist via the new `isBlocked` override instead.
- [x] 9.6 Add a regression test in `ContentSourceSupportSpec` that proves the pin holds: fetch a URL whose hostname is not a real, resolvable DNS name (so an independent second resolution — the pre-fix behavior — would fail with `UnknownHostException`); assert the fetch still succeeds (proving the connection was pinned to the `resolveHost` answer, never re-resolved) and that `resolveHost` was invoked exactly once. Probe-confirmed by temporarily reverting the `.withTransport(...)` call and observing this exact test fail with `UnknownHostException`, then re-applying the fix and observing it pass.
