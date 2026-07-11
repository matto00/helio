## Backend — domain / persistence

- `backend/src/main/scala/com/helio/domain/DataSource.scala` — new `ImageSourceConfig`/`ImageSource` case classes; `DataSourceKind.Image` added to `All`.
- `backend/src/main/resources/db/migration/V49__add_image_source_type.sql` — new migration extending `data_sources_source_type_check` to include `'image'` (renumbered from V48 during the post-HEL-214-merge rebase, since HEL-214's merged V48 claimed that version number first; additive on top of V48's `'pdf'` addition).
- `backend/src/main/scala/com/helio/api/protocols/DataSourceConfigCodec.scala` — `decodeImage`/`encodeImage` (mirrors `decodeText`/`encodeText`).
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` — `ImageSource` wired into `rowToDomain`/`domainToRow`/`update`'s closed matches.
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — `ImageSource` case added to `update`'s rename match; new `createImageUpload`/`createImageUrl`/private `ingestImage` (upload + URL ingestion, extension/size/dimension validation, `FileSystem` write, `DataType` registration); `refreshImage`/`finishImageRefresh`; `delete` now removes the stored file for `ImageSource`; new `imageMaxBytes` (`IMAGE_MAX_FILE_SIZE_BYTES`, default 20 MB).

## Backend — image-specific helpers

- `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` — new `ImageExtensions` set (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`).
- `backend/src/main/scala/com/helio/services/ImageSourceSupport.scala` — new file: `dimensionsAndMime(bytes, filename)` reads width/height via `javax.imageio.ImageIO.read` and derives MIME type from the validated extension. **Cycle 2 fix (evaluator FAIL)**: wrapped the `ImageIO.read` call in a `try/catch` for `java.io.IOException` (which `javax.imageio.IIOException` extends) — previously only the documented `null`-return case was handled, so a truncated-but-header-valid corrupt image (recognized header, corrupt pixel data — e.g. an interrupted upload) threw uncaught and surfaced as a raw 500 instead of the intended graceful 400. Mirrors `PdfTextSupport.validate`'s established try/catch structure for the equivalent PDFBox failure mode.

## Backend — wire protocol + routes

- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — new `ImageSourceResponse`, `ImageSourceConfigPayload`, `ImageSourceUrlConfigPayload`, `ImageSourceUrlRequest`; `DataSourceResponse.fromDomain` and the discriminated-union read/write format extended for `type = "image"`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports for the new `ImageSource*` protocol types (mirrors the existing `TextSource*` re-exports), needed since `DataSourceRoutes.scala` resolves these via `import com.helio.api._`.
- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala` — multipart upload branch and JSON URL-ingestion branch both gain an `Image` case (own `IMAGE_MAX_FILE_SIZE_BYTES` early-rejection check).

## Backend — pipeline row-loading + binary_refs wiring

- `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala` — **blocking fix (task 5.1a, skeptic design-gate)**: `anyToJsValue` gains a `case m: Map[String, Any] => JsObject(...)` before the catch-all, so a nested `Map` (the image connector's `content`/`BinaryRef` value) serializes to a real JSON object instead of a stringified Scala `Map`.
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — new `case i: ImageSource` in `loadRows` + private `loadImageRowFromBytes` helper (single row: nested `content` binary-ref map plus top-level `filename`/`sizeBytes`/`mimeType`/`width`/`height`).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — new nullable `binaryRefRepo: BinaryRefRepository` constructor param; `onRunSuccess` gains `extractBinaryRefs`/`isBinaryRefShape` and a `binaryRefsUpsert` step that calls `binaryRefRepo.overwriteForDataType` whenever `resultRows` contain `binary-ref`-shaped values (generic over source kind, not image-specific).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — new nullable `binaryRefRepo: BinaryRefRepository` constructor param, threaded into `PipelineRunService`.
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `new BinaryRefRepository(ctx)` and passes it to `ApiRoutes` (first real wiring of the HEL-217 class).

## Frontend

- `frontend/src/features/sources/types/dataSource.ts` — `"image"` added to `DataSourceKind`; new `ImageSourceConfig`/`ImageSource` types + `isImageSource` helper.
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — `"image"` added to the local `SourceType` union; new "Image" toggle button.
- `frontend/src/features/sources/ui/ImageSourceForm.tsx` — new file, mirrors `TextSourceForm.tsx` (file-picker + URL sub-modes).
- `frontend/src/features/sources/ui/ImageSourceForm.test.tsx` — new file, mirrors `TextSourceForm.test.tsx`.
- `frontend/src/features/sources/services/dataSourceService.ts` — new `createImageSourceUpload`/`createImageSourceUrl`.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — `"image"` added to the local `SourceType` union; new `handleCreateImage`; renders `ImageSourceForm` for `sourceType === "image"`.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — new `describe("AddSourceModal — image source (HEL-216)")` block mirroring the existing text-source tests.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — `"image"` case added to `labelForKind`.
- `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` — `"image"` case added to its own `labelForKind` switch (otherwise non-exhaustive against the widened `DataSourceKind` union).
- `frontend/src/features/sources/ui/AddSourceModal.css` — **Cycle 3 fix (skeptic final-gate REFUTE)**: added the previously-missing `.add-source-modal__actions` / `.add-source-modal__btn` / `--primary` / `--secondary` rules, mirroring the token-based `.ui-modal-btn` system in `shared/ui/Modal.css`. `ImageSourceForm.tsx` (this ticket's own form) and its already-merged siblings referenced these class names, but the classes were never defined anywhere in the codebase, so the footer buttons rendered with zero visual chrome. Additive-only — no `.tsx` files touched; fixes all four forms' buttons as a side effect since they share the same class names.

## Tests

- `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala` — `ImageSource` added to the `kind` and exhaustive-match coverage (was a compiler warning before this change).
- `backend/src/test/scala/com/helio/domain/PipelineRowJsonSpec.scala` — new file, regression coverage for the task 5.1a fix (nested `Map` → real `JsObject`; existing scalar cases unchanged).
- `backend/src/test/scala/com/helio/services/ImageSourceSupportSpec.scala` — new file, unit tests for `dimensionsAndMime` (valid PNG/JPEG, corrupt bytes, unsupported extension). **Cycle 2**: added a truncated-but-header-valid PNG case (real PNG with trailing bytes dropped) to exercise the `IOException`-throw branch distinctly from the existing total-garbage-bytes (`null`-return) case.
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala` — new `createImageUpload`/`createImageUrl`/`refresh (Image)`/`delete (Image)`/`update (Image)` sections mirroring the existing text sections, plus image test-server routes. **Cycle 2**: added a truncated-PNG `createImageUpload` case asserting the same `BadRequest` outcome as the garbage-bytes case.
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — new "image upload" / "image URL ingestion" route-test sections (multipart + JSON, including SSRF guard reuse cases). **Cycle 2**: added a truncated-PNG upload case asserting `400 BadRequest` at the route layer.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — new `ImageSource` `loadRows` tests (single row with nested `content`, missing-path error, corrupt-bytes error).
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — new `binaryRefRepo` wiring in `makeRoutes` + `seedDsImage` helper + 3 tests proving `binary_refs` population/replace-on-rerun/no-rows-for-non-image-sources, and that `data_type_rows.data.content` round-trips as a real JSON object.
