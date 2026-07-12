# Files modified — HEL-246 image-upload-panel

## Backend

- `backend/src/main/resources/db/migration/V54__image_uploads.sql` — new `image_uploads` table
  (`id`, `owner_id`, `storage_key`, `mime_type`, `filename`, `size_bytes`, `created_at`), owner
  index, RLS enabled + forced, direct-owner policy (task 1.1).
- `backend/src/main/scala/com/helio/domain/model.scala` — added `ImageUploadId` value class and
  `ImageUpload` domain case class (task 1.2).
- `backend/src/main/scala/com/helio/infrastructure/ImageUploadRepository.scala` — new: `insert`
  via `withUserContext`, `findById` via `withSystemContext` for the unauthenticated serve path
  (task 1.3).
- `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` — added
  `"image_uploads"` to the `rlsTables` allowlist (task 1.4, CONTRIBUTING.md's binding checklist).
- `backend/src/main/scala/com/helio/services/ImageUploadService.scala` — new: extension
  validation (narrower 5-extension allow-list, not `ContentSourceSupport.ImageExtensions`), size
  limit (`IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`), `FileSystem.write` at `images/<uuid>.<ext>`, and a
  local MIME-by-extension map (deliberately not `ImageSourceSupport.dimensionsAndMime` — no WebP
  reader on this JVM) (task 2.1).
- `backend/src/main/scala/com/helio/api/routes/UploadRoutes.scala` — new: authenticated
  `POST /uploads/image` multipart route mirroring `DataSourceRoutes`'s collection pattern (task 2.2).
- `backend/src/main/scala/com/helio/api/routes/PublicUploadRoutes.scala` — new: unauthenticated
  `GET /uploads/image/:id` byte-serving route (task 2.3).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — wired `ImageUploadRepository` (nullable
  default, mirrors `apiTokenRepo`/`binaryRefRepo`), `imageUploadServiceOpt`, mounted
  `PublicUploadRoutes` alongside `PublicDashboardRoutes` under `optionalAuthenticate` and
  `UploadRoutes` alongside the other authenticated routes (task 2.4).
- `backend/src/main/scala/com/helio/app/Main.scala` — constructs `ImageUploadRepository` (reusing
  the existing `fileSystem` instance) and passes it into `ApiRoutes` (task 2.4).
- `backend/src/main/scala/com/helio/api/protocols/ImageUploadProtocol.scala` — new:
  `ImageUploadResponse { id, url }` + its Spray JSON formatter (task 2.5).
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — mixed in `ImageUploadProtocol`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exported `ImageUploadResponse` so
  `import com.helio.api._` call sites see it (same pattern as every other protocol type).
- `backend/src/main/scala/com/helio/api/protocols/IdParsing.scala` — added `ImageUploadIdSegment`
  path matcher.
- `backend/src/test/scala/com/helio/infrastructure/RlsOwnerTablesSpec.scala` — added an
  "RLS on image_uploads" section seeding through `ImageUploadRepository.insert` (not raw SQL) to
  prove the real write path is RLS-scoped (task 5.3).
- `backend/src/test/scala/com/helio/api/UploadRoutesSpec.scala` — new: route-level coverage for
  all 5 allowed extensions, missing/unsupported/oversized/at-limit uploads, unauthenticated POST
  (401), and unauthenticated GET serving bytes/Content-Type + 404 for unknown id (tasks 5.1, 5.2).

## Frontend

- `frontend/src/features/panels/services/panelService.ts` — added `uploadPanelImage(file)`
  (multipart POST to `/api/uploads/image`, mirrors `dataSourceService.createCsvSource`) (task 3.1).
- `frontend/src/features/panels/ui/editors/ImageEditor.tsx` — added an "Upload" control (hidden
  file input + visible button, DESIGN.md secondary-button recipe) beside the URL field; on success
  sets `imageUrl` to the returned URL, on failure shows an inline error without clobbering the
  existing URL (task 3.2).
- `frontend/src/features/panels/ui/PanelDetailModal.css` — added
  `.panel-detail-modal__upload-row/-input/-btn` styles for the new Upload control.
- `frontend/src/features/panels/ui/ImagePanel.tsx` — `sanitizeImageUrl` now resolves against
  `window.location.origin` so root-relative `/api/uploads/image/<id>` paths parse; added a
  same-origin guard so a protocol-relative-smuggled path (`//evil.com/x`) falls through to the
  existing "any absolute http(s) URL" behavior instead of being rendered as a literal (task 3.3).
- `frontend/src/features/panels/ui/ImagePanel.test.tsx` — added coverage for the root-relative
  upload path and the protocol-relative-smuggling guard (task 5.5).
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` — added `uploadPanelImage` mock and
  an "Image editor upload" describe block covering the success and failure paths (task 5.4).

## Docs

- `notes/uploads-filesystem-layout.md` — new: documents the `images/<uuid>.<ext>` prefix
  alongside the pre-existing `image/<sourceId>.<ext>` HEL-216 connector prefix, and why the two
  metadata tables (`image_uploads` vs `binary_refs`) are kept separate (task 4.1).
