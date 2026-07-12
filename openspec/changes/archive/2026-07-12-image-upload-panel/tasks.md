## 1. Backend: data model & storage

- [x] 1.1 Add Flyway migration `V54__image_uploads.sql`: `image_uploads` table
      (`id TEXT PRIMARY KEY`, `owner_id UUID NOT NULL`, `storage_key TEXT NOT NULL`,
      `mime_type TEXT NOT NULL`, `filename TEXT NOT NULL`, `size_bytes BIGINT NOT NULL`,
      `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`), index on `owner_id`, `ENABLE`/`FORCE ROW
      LEVEL SECURITY`, and an `image_uploads_owner` policy (`owner_id =
      current_setting('app.current_user_id')::uuid`).
- [x] 1.2 Add `ImageUpload` domain case class (`backend/src/main/scala/com/helio/domain/`).
- [x] 1.3 Add `ImageUploadRepository` (`backend/src/main/scala/com/helio/infrastructure/`): `insert`
      via `withUserContext(ownerId)`, `findById` via `withSystemContext` (serve path).
- [x] 1.4 Add `"image_uploads"` to the `rlsTables` allowlist in
      `backend/src/test/scala/com/helio/infrastructure/RlsPolicyGuardSpec.scala` (mirrors how
      `"binary_refs"` was added for V46/HEL-217) — CONTRIBUTING.md's binding "Adding a new ACL'd
      table" checklist requires this in the same PR as the migration.

## 2. Backend: service & routes

- [x] 2.1 Add `ImageUploadService`: extension validation against `{png, jpg, jpeg, gif, webp}`
      (via `ContentSourceSupport.validateExtension` with a local allow-list), size-limit check
      (`IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`, default 10485760), `FileSystem.write` at
      `images/<uuid>.<ext>`, repository insert, and a `findById`-then-`FileSystem.read` path for
      serving. Derive `mime_type` from a small local extension-keyed literal map
      (`png/jpg/jpeg/gif/webp` → standard MIME types) — do NOT call
      `ImageSourceSupport.dimensionsAndMime` (its `ImageIO.read` has no WebP reader on this
      toolchain and would reject valid `.webp` uploads); no width/height decode is needed here.
- [x] 2.2 Add `UploadRoutes` (authenticated): `POST /uploads/image` multipart handling mirroring
      `DataSourceRoutes.createMultipartUploadRoute`'s `Multipart.FormData` collection pattern;
      route-level size pre-check + service-level authoritative check; `201` with `{id, url}` or
      `400`/`413` errors.
- [x] 2.3 Add `PublicUploadRoutes` (unauthenticated): `GET /uploads/image/:id` — reads via
      `ImageUploadService`, responds with the stored `Content-Type` and bytes, `404` if not found.
- [x] 2.4 Wire both into `ApiRoutes.scala`: `PublicUploadRoutes` alongside `PublicDashboardRoutes`
      under `optionalAuthenticate`; `UploadRoutes` alongside the other authenticated routes.
      Construct `ImageUploadRepository`/`ImageUploadService` in `Main.scala` (reuse the existing
      `fileSystem` instance).
- [x] 2.5 Add JSON protocol formatters (`ImageUploadResponse { id, url }`) to
      `JsonProtocols.scala` / a protocols file consistent with existing response shapes.

## 3. Frontend

- [x] 3.1 Add `uploadPanelImage(file: File)` to a panels service module (FormData + `httpClient.post`
      with `multipart/form-data`, mirroring `dataSourceService.createCsvSource`), returning
      `{ id, url }`.
- [x] 3.2 Update `ImageEditor.tsx`: add an "Upload" control (file input + button, per DESIGN.md)
      beside the URL `TextField`; on file selection, call `uploadPanelImage`, set `imageUrl` to the
      returned `url`, surface upload errors via `InlineError` without clobbering the existing URL
      on failure.
- [x] 3.3 Update `ImagePanel.tsx`'s `sanitizeImageUrl` to parse with
      `new URL(url, window.location.origin)` so root-relative `/api/uploads/image/<id>` paths are
      accepted alongside absolute `http(s)://` URLs, while still rejecting other schemes.

## 4. Docs

- [x] 4.1 Write `notes/uploads-filesystem-layout.md`: document the `images/<uuid>.<ext>` prefix
      used by this endpoint, the pre-existing `image/<sourceId>.<ext>` prefix used by the HEL-216
      connector, and the `HELIO_UPLOADS_ROOT`/GCS bucket root each resolves under.

## 5. Tests

- [x] 5.1 Backend: `POST /uploads/image` — successful upload (each of the 5 allowed extensions),
      missing file, unsupported extension, oversized file, unauthenticated request.
- [x] 5.2 Backend: `GET /uploads/image/:id` — serves correct bytes/Content-Type for a valid id,
      `404` for unknown id, works without an `Authorization` header.
- [x] 5.3 Backend: RLS — insert runs under the uploading user's context;
      `image_uploads` has RLS enabled post-migration (mirrors `rls-owner-tables` test patterns).
- [x] 5.4 Frontend: `ImageEditor` upload flow (success sets `imageUrl`; failure shows inline error
      and preserves prior `imageUrl`).
- [x] 5.5 Frontend: `ImagePanel` renders correctly for a root-relative `/api/uploads/image/<id>`
      `imageUrl` (existing absolute-URL and placeholder cases must still pass).
