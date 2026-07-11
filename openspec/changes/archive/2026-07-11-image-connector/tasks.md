## 1. Backend: domain + persistence

- [x] 1.1 Add `ImageSourceConfig(path, sourceUrl: Option[String])` and `ImageSource` case class to
      `domain/DataSource.scala`; add `DataSourceKind.Image = "image"` to `All`.
- [x] 1.2 Add Flyway migration (next `V` after `V47`) dropping/recreating
      `data_sources_source_type_check` to include `'image'`.
- [x] 1.3 Add `DataSourceConfigCodec.decodeImage`/`encodeImage` for `ImageSourceConfig` (path +
      optional sourceUrl) — mirrors `decodeText`/`encodeText`.
- [x] 1.4 Wire `ImageSource` into `DataSourceRepository.rowToDomain`/`domainToRow`/`update`'s closed
      matches.
- [x] 1.5 Add an `ImageSource` case to `DataSourceService.update`'s closed match (rename path).

## 2. Backend: image-specific helpers

- [x] 2.1 Add `ContentSourceSupport.ImageExtensions: Set[String]` (`png`, `jpg`, `jpeg`, `gif`,
      `webp`, `bmp`), alongside the existing `TextExtensions`.
- [x] 2.2 Create `services/ImageSourceSupport.scala` with
      `dimensionsAndMime(bytes: Array[Byte], filename: String): Either[String, (Int, Int, String)]`
      — reads width/height via `javax.imageio.ImageIO.read` (JDK-standard, no new dependency),
      returns `Left` with a descriptive message if `ImageIO.read` returns `null`; derives MIME type
      from the validated extension via a fixed map.

## 3. Backend: service + wire protocol

- [x] 3.1 Add `ImageSourceConfigPayload`, `ImageSourceResponse`, `ImageSourceUrlConfigPayload`,
      `ImageSourceUrlRequest` (`{name, type, config: {url}}`) to `DataSourceProtocol`; extend the
      `DataSourceResponse` discriminated-union format for `type = "image"`.
- [x] 3.2 Add `DataSourceService.createImageUpload(name, bytes, filename, user)` /
      `createImageUrl(name, url, user)`, sharing a private `ingestImage` (extension validation via
      `ContentSourceSupport.validateExtension(_, ImageExtensions)`, size check against
      `IMAGE_MAX_FILE_SIZE_BYTES`, `ImageSourceSupport.dimensionsAndMime` validation, `FileSystem`
      write at `image/<sourceId>.<ext>`, `DataType` registration: `ContentSourceSupport
      .metadataFields(BinaryRefType, filename, sizeBytes)` plus `width`/`height`
      (`IntegerType`)/`mimeType` (`StringType`) appended).
- [x] 3.3 Extend `DataSourceService.refresh` with an `ImageSource` case: re-read stored file if
      `sourceUrl` is `None`, re-fetch + overwrite if `Some`; re-derive `width`/`height`/`mimeType`.
- [x] 3.4 Extend `DataSourceService.delete` to call `FileSystem.delete` for `ImageSource` (mirrors
      `CsvSource`/`TextSource`).
- [x] 3.5 Read `IMAGE_MAX_FILE_SIZE_BYTES` (default 20971520); enforce in `ingestImage` for both
      upload-bytes and URL-fetch byte-count, returning `ServiceError.PayloadTooLarge` (existing
      variant from HEL-215 — no new `ServiceError` case needed).

## 4. Backend: routes

- [x] 4.1 Extend `createMultipartUploadRoute`'s `typeStr` branch with an `Image` case (own
      `IMAGE_MAX_FILE_SIZE_BYTES` early-rejection check, mirroring the text branch), calling
      `dataSourceService.createImageUpload`.
- [x] 4.2 Extend `createStaticRoute`'s JSON `type` dispatch with an `Image` branch, `convertTo
      [ImageSourceUrlRequest]`, calling `dataSourceService.createImageUrl`.

## 5. Backend: pipeline row-loading + binary_refs wiring

- [x] 5.1 Add a `case i: ImageSource` to `InProcessPipelineEngine.loadRows`: read the stored file,
      call `ImageSourceSupport.dimensionsAndMime`, return one row with `content` (the `binary-ref`
      map: `storageKey` = `i.config.path`, `mimeType`, `filename`, `sizeBytes`), plus top-level
      `filename`, `sizeBytes`, `mimeType`, `width`, `height`.
- [x] 5.1a **[Skeptic design-gate round 1, blocking]** Fix `PipelineRowJson.anyToJsValue`
      (`backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:26-37`) to handle a nested
      `Map[String, Any]` value: add `case m: Map[String, Any] @unchecked => JsObject(m.map { case
      (k, v) => k -> anyToJsValue(v) })` before the catch-all `case _ => JsString(v.toString)`.
      Without this, the `content` field's nested `BinaryRef` map (task 5.1) serializes into a
      stringified Scala `Map` instead of a JSON object when `PipelineRunService.executeRun` builds
      `jsRows` for `dataTypeRowRepo.overwriteRows` — corrupting `data_type_rows.data.content`, the
      sole row-read path, even though the separate `binary_refs` extraction (task 5.3, which reads
      pre-serialization `resultRows`) would still succeed, leaving the two data stores
      inconsistent. Must land before task 5.1/5.3 can be considered correct.
- [x] 5.2 Add a `binaryRefRepo: BinaryRefRepository = null` constructor param to
      `PipelineRunService`; construct `new BinaryRefRepository(dbContext)` in `ApiRoutes` and thread
      it through (mirrors the existing `pipelineRunRepo`/`dataTypeRowRepo` nullable pattern).
- [x] 5.3 In `PipelineRunService.onRunSuccess`, after `rowsUpsert` succeeds, scan `resultRows` for
      any field value matching the `BinaryRef` shape (a map with `storageKey`/`mimeType`/`filename`/
      `sizeBytes` keys) and build one `BinaryRef` per match (fresh `id`, `dataTypeId =
      outputDataTypeId.value`, `rowIndex` = row index, `fieldName` = the map key); call
      `binaryRefRepo.overwriteForDataType(outputDataTypeId.value, refs)` (guarded by
      `if (binaryRefRepo != null)`) in the same `for`-comprehension as `rowsUpsert`/`schemaUpsert`.

## 6. Frontend

- [x] 6.1 Add `"image"` to the `DataSourceKind` union and `SourceType` union
      (`AddSourceModal.tsx`/`SourceTypeToggle.tsx`); add `ImageSourceConfig`/`ImageSource` types and
      `isImageSource` helper to `features/sources/types/dataSource.ts`.
- [x] 6.2 Add a toggle entry ("Image") to `SourceTypeToggle.tsx`.
- [x] 6.3 Add `ImageSourceForm.tsx` supporting both file-picker and URL-entry sub-modes (mirrors
      `TextSourceForm.tsx`; `accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,image/*"`).
- [x] 6.4 Add `createImageSourceUpload`/`createImageSourceUrl` to
      `features/sources/services/dataSourceService.ts` (mirrors `createTextSourceUpload`/
      `createTextSourceUrl`).
- [x] 6.5 Wire the create path in `AddSourceModal.tsx` for the new `"image"` source type
      (`handleCreateImage`, rendering `ImageSourceForm` when `sourceType === "image"`).
- [x] 6.6 Add a `case "image": return "Image";` to `SourceDetailPanel.tsx`'s `labelForKind` switch.

## 7. Tests

- [x] 7.1 Backend: `DataSourceService` tests for `createImageUpload`/`createImageUrl` (valid image,
      unsupported extension, unreadable/corrupt image bytes, oversized -> `PayloadTooLarge`/413,
      refresh both variants, delete, `update`/rename on `ImageSource`).
- [x] 7.2 Backend: `DataSourceRoutes` tests — multipart `type=image` upload, JSON URL creation, and
      regressions confirming CSV/text/static creation still work unchanged.
- [x] 7.3 Backend: `InProcessPipelineEngine.loadRows` test for `ImageSource` (single row, correct
      keys/values including nested `content` map).
- [x] 7.3a Backend: `PipelineRowJsonSpec` (or extend existing) regression test proving
      `anyToJsValue` converts a nested `Map[String, Any]` into a genuine `JsObject` (not a
      stringified map), and that existing scalar-value serialization (`Int`/`Long`/`Double`/
      `String`/`Boolean`/`null`) is unchanged. Additionally, an end-to-end
      `PipelineRunService`/`DataTypeRowRepository` test asserting a pipeline run over an
      `ImageSource` writes a real JSON object (not a string) into `data_type_rows.data.content`,
      round-tripping correctly through the row-read path (e.g. `GET /api/types/:id/rows`).
- [x] 7.4 Backend: `ImageSourceSupport.dimensionsAndMime` unit tests (valid PNG/JPEG, corrupt bytes,
      MIME derivation per extension).
- [x] 7.5 Backend: `PipelineRunService` test proving a successful run over an `ImageSource` writes
      matching `binary_refs` rows, a re-run replaces (not accumulates) them, and a run over a
      `CsvSource`/`StaticSource` writes no `binary_refs` rows.
- [x] 7.6 Frontend: `AddSourceModal`/`ImageSourceForm` tests for upload and URL sub-modes.

## 8. Security regression check (reuse mandate)

- [x] 8.1 Confirm (by code inspection + a targeted test) that image URL ingestion goes exclusively
      through `ContentSourceSupport.fetchUrl`/`validateUrl` — no new HTTP client code path — so the
      existing SSRF guard (scheme allowlist, loopback/link-local/RFC1918/unique-local-IPv6/
      multicast denylist, DNS-rebinding pin, no upstream-body leak) applies unchanged to image URL
      ingestion.
