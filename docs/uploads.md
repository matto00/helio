# Uploaded images & the `helio://` markdown scheme

Helio stores small, panel-literal images (logos, illustrations, screenshots)
through a dedicated uploads endpoint, separate from the pipeline/data-source
path. This doc covers the two HTTP endpoints (HEL-246) and the
`helio://uploads/image/<id>` reference scheme that Markdown panels resolve
(HEL-245).

## Storage backend

Image bytes are persisted through a configurable file-system backend, selected
by `HELIO_UPLOADS_BACKEND` (`local` | `gcs`, default `local`). Markdown
image-ref resolution and the byte-serving endpoint go through the uploads route,
never a raw filesystem path — so stored references stay portable across
environments and backends. See the `HELIO_UPLOADS_*` variables in the root
`CLAUDE.md` for storage configuration.

## Endpoints

### `POST /api/uploads/image` (authenticated)

Multipart upload of a single image file (form field `file`).

- Allowed extensions: `png`, `jpg`, `jpeg`, `gif`, `webp`.
- Maximum size: 10 MiB by default, overridable via the
  `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES` environment variable.
- Response: `{ "id": "<id>", "url": "/api/uploads/image/<id>" }`. The `url` is a
  root-relative path, so it can be dropped straight into an `<img src>` or an
  Image panel's `imageUrl`.

Example:

```bash
curl -X POST https://your-helio-host/api/uploads/image \
  -H "Cookie: helio_session=…" \
  -F "file=@logo.png"
# → { "id": "3f9c…", "url": "/api/uploads/image/3f9c…" }
```

### `GET /api/uploads/image/:id` (public)

Unauthenticated byte-serving of a previously-uploaded image, with the stored
MIME type (`image/png`, `image/jpeg`, `image/gif`, `image/webp`). This is the
endpoint every rendered image ultimately points at. It is intentionally public,
matching the pre-existing trust model where any external `imageUrl` was already
world-readable.

## The `helio://uploads/image/<id>` markdown scheme

Markdown panels can embed uploaded images with a stable, environment-portable
reference:

```markdown
![Company logo](helio://uploads/image/3f9c1e2a-…)
```

At render time the Markdown panel rewrites `helio://uploads/image/<id>` to
`/api/uploads/image/<id>` via a custom react-markdown `urlTransform`
(`frontend/src/features/panels/ui/markdownUrls.ts`). This is necessary because
react-markdown's default URL transform strips unknown protocols — a bare
`helio://` URL would otherwise resolve to an empty `src`.

Notes:

- `<id>` must be a single safe path segment (`[A-Za-z0-9._-]+`, excluding `.`
  and `..`). Anything else (a slash, a query string, a traversal id) is rejected
  and falls through to the default transform, which strips the unresolved
  `helio://` URL.
- The transform applies to both links and images: a `helio://` link resolves to
  the same asset as the equivalent image ref.
- A plain root-relative `/api/uploads/image/<id>` URL **also** renders — it
  survives the default transform unchanged. `helio://` is recommended because it
  reads as an intentional, portable asset reference rather than an
  implementation-specific path.

### Why render-time, not stored rewriting

Resolution happens in the frontend at render time rather than rewriting the
stored markdown on the backend. This keeps stored content portable across
environments (dev/prod, local/GCS) and storage-backend agnostic — the stored
reference is always the abstract `helio://` form.
