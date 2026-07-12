## Why

Image panels only accept an externally-hosted URL today. Users want to upload an image directly
from their machine. HEL-246 adds a FileSystem-backed upload endpoint and wires the Image panel's
config UI to it, unblocking HEL-245 (Markdown image references) later.

## What Changes

- New `POST /api/uploads/image` — multipart upload, validates extension against
  `{png, jpg, jpeg, gif, webp}`, persists via the existing `FileSystem` abstraction under an
  `images/` prefix, returns `{ id, url }`. Requires authentication; `owner_id` recorded for
  audit/future cleanup (not enforced on read — see design.md).
- New `GET /api/uploads/image/:id` — serves stored bytes with the correct `Content-Type`. Mounted
  unauthenticated (alongside `PublicDashboardRoutes`) because a plain `<img src>` cannot carry a
  Bearer token; the UUID id is the access capability, matching how any external image URL was
  already trusted with no auth check.
- New `image_uploads` table (Flyway) storing `{id, owner_id, storage_key, mime_type, filename,
  size_bytes, created_at}` — RLS-enabled, owner policy for future scoped listing; reads for serving
  go through `withSystemContext` by design (see above).
- Image panel config UI (`ImageEditor.tsx`) gains an "Upload" button beside the existing URL text
  field; a successful upload sets `imageUrl` to the returned `url` exactly like a typed URL.
- `ImagePanel.tsx`'s URL sanitizer is extended to accept the new internal upload URL alongside
  `http(s)://` URLs (currently rejects anything `new URL()` can't parse as absolute http/https).
- `notes/uploads-filesystem-layout.md` documents the `images/` prefix alongside the existing
  `image/` (singular) prefix used by the HEL-216 image data-source connector.

## Capabilities

### New Capabilities

- `image-upload`: multipart image upload endpoint, byte-serving endpoint, storage/validation
  rules, and the backing table.

### Modified Capabilities

- `image-panel-type`: config UI gains an upload path; the panel's URL handling accepts the new
  internal upload URL scheme in addition to external `http(s)://` URLs.

## Non-goals

- No Markdown-panel image-reference wiring (HEL-245's scope).
- No image listing/management UI, no delete endpoint, no per-user upload quota.
- No reuse of `binary_refs` (HEL-217) — that table's FK/RLS policy is scoped to
  `data_type_id`/row/field triples for pipeline-bound content and doesn't fit a standalone
  panel-literal upload; only its metadata *shape* (`storageKey`/`mimeType`/`filename`/`sizeBytes`)
  is reused.

## Impact

- Backend: new route/service/repository classes, one Flyway migration (V54), `ApiRoutes.scala` /
  `Main.scala` wiring.
- Frontend: `ImageEditor.tsx`, `ImagePanel.tsx`, a new upload service function.
- Docs: `notes/uploads-filesystem-layout.md`.
