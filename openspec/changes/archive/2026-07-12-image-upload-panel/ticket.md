# HEL-246: Image panel + FileSystem-backed upload endpoint

Parent epic: HEL-239 (Helio v1.5 — Panel System v2)
Project: Helio v1.5 — Panel System v2

## Description

Today Image panels only accept a URL. Users want to upload images directly.
Use the existing `FileSystem` abstraction so the same storage path migrates
to blob storage when that lands.

## Scope

- New backend endpoint `POST /api/uploads/image` — accepts multipart, validates
  MIME (jpeg/png/webp/gif), persists via `FileSystem.write` under an `images/`
  prefix, returns `{ id, url }` where `url` is a stable internal scheme
  (e.g. `helio://uploads/image/<id>` or `/api/uploads/image/<id>`).
- New backend endpoint `GET /api/uploads/image/<id>` — serves the bytes with
  correct content-type.
- Image panel config UI gains an "Upload" button alongside the URL input.
- The returned URL is stored on the panel like any other image URL (no
  separate panel-content storage).

## Constraints

- Use `FileSystem` only — no direct `java.nio.file` calls. Blob storage
  migration must be a config swap.
- Size limit: 10 MB per image (configurable, default in `application.conf`).
- Reject non-image MIME types at the route level.

## Definition of Done

- Upload from Image panel config works end-to-end
- Same uploaded images are referenceable from Markdown panels (see sibling
  ticket, HEL-245) — NOTE: HEL-245 (Markdown config + uploaded-image
  references) is a separate, not-yet-started ticket. This ticket's scope is
  the upload endpoint + Image panel wiring only; the Markdown-reference
  wiring itself belongs to HEL-245. Flag to orchestrator if this boundary is
  ambiguous during planning.
- File system layout documented in `notes/`
- Tests cover upload, serve, size-limit reject, MIME-reject paths

## Orchestrator notes (from human, do not treat as ticket content)

- REUSE existing infrastructure — do NOT reinvent storage. There is already
  an uploads/file-storage abstraction (local | gcs) configured via
  `HELIO_UPLOADS_BACKEND` / `HELIO_UPLOADS_BUCKET` / `HELIO_UPLOADS_ROOT`,
  with a `LocalFileSystem` implementation (see CLAUDE.md's production-env
  table and `backend/src/main/scala/com/helio/infrastructure/`). The image
  upload endpoint MUST use that abstraction (so it works with both local dev
  and GCS prod), not a bespoke file writer.
- HEL-216 (image data source connector, merged) and HEL-217 (BinaryRefType +
  `binary_refs` table) already established binary storage patterns and the
  `{storageKey, mimeType, filename, sizeBytes}` shape. Reuse those
  conventions where applicable; look at `ImageSourceSupport.scala` / the
  image connector for existing image-handling code before writing new code.
- If image upload for panels needs auth/ownership scoping, validation
  (MIME/type/size limits), and a retrieval path, wire those consistently
  with existing endpoints.
- Build on HEL-243/HEL-244's panel-config-editor pattern for the Image
  panel's config UI (BoundOrLiteralField / the editors in
  `frontend/src/features/panels/ui/editors/`) where it fits — an image panel
  likely references an uploaded image by storage key/URL.
- Watch for scope boundaries (the HEL-252/253/244 lesson): if part of this
  is already implemented by the HEL-216 connector work, or if the
  Markdown-image-reference piece bleeds into HEL-245's scope, ESCALATE the
  boundary rather than assuming.
- If this ticket needs a Flyway migration, the next free version is V54
  (max existing is V53__panel_column_widths.sql as of branch cut).
- Bind to DESIGN.md for all frontend work.
