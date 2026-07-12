## Context

Image panels (`image-panel-type`) render `<img src={config.imageUrl}>` sourced from a plain text
field (`ImageEditor.tsx`); `ImagePanel.tsx`'s `sanitizeImageUrl` calls `new URL(url)` and rejects
anything whose protocol isn't `http:`/`https:`. HEL-216 already built an image *data-source*
connector (`DataSourceService.ingestImage`, `ImageSourceSupport.dimensionsAndMime`,
`ContentSourceSupport.validateExtension`) that writes to `FileSystem` at `image/<sourceId>.<ext>`
and creates a bindable `DataType` + `binary_refs` row — that whole path exists for pipeline-bound
image *data*, not for a panel-literal upload, and its `binary_refs` table's RLS policy and UNIQUE
constraint are keyed on `(data_type_id, row_index, field_name)`, which has no meaning here.
`FileSystem` (local/GCS) and its size-limit / extension-validation helpers are directly reusable;
the data-source-specific plumbing is not.

## Goals / Non-Goals

**Goals:**
- Multipart upload → `FileSystem` write → `{id, url}`, and a byte-serving GET, reusing
  `ContentSourceSupport.validateExtension` / the `FileSystem` trait exactly as the image connector
  does.
- Wire the Image panel's config UI to the new endpoint without disturbing its existing
  literal-URL path.

**Non-Goals:**
- Reusing `binary_refs` or creating a `DataType`/`DataSource` record for the uploaded image (this
  is a standalone asset, not pipeline-bound data).
- Ownership-restricted reads, listing, deletion, or quotas.
- Markdown-panel wiring (HEL-245).

## Decisions

1. **New `image_uploads` table, not `binary_refs` reuse.** `binary_refs`' RLS policy and UNIQUE
   constraint assume a `(data_type_id, row_index, field_name)` triple; forcing a panel upload into
   that shape would mean inventing a fake `data_type_id`, violating design.md Decision 4 from
   HEL-217 ("never an independent read path"). A new table mirrors only the *field shape*
   (`storage_key`, `mime_type`, `filename`, `size_bytes`) per the ticket's guidance, with its own
   `owner_id` + RLS policy — same pattern as `binary_refs`' migration (V46) but a direct-owner
   policy (`owner_id = current_setting('app.current_user_id')::uuid`) since there's no parent row.
   Alternative considered: encode metadata in the filename (`images/<id>.<ext>`) and derive MIME
   from extension at GET time via `FileSystem.list`. Rejected — every other entity in this codebase
   is backed by a Postgres row, and `list()` is a linear scan with no indexed lookup by id.

2. **GET is mounted unauthenticated, alongside `PublicDashboardRoutes`.** The frontend auth
   transport is a Bearer token attached by an axios interceptor (`httpClient.ts`), never a cookie —
   a plain `<img src>` cannot carry it. Reusing the existing `optionalAuthenticate` mount point
   (`ApiRoutes.scala` line ~118) for a new `PublicUploadRoutes` (GET only) keeps the same
   "capability URL" trust model already implicit in `imageUrl` accepting *any* external URL with no
   auth today. `POST /api/uploads/image` stays behind `authDirectives.authenticate` like every
   other mutating route, mirroring the `PublicDashboardRoutes` vs. `DashboardRoutes` split already
   in `ApiRoutes.scala`.

3. **RLS: write is user-scoped (`withUserContext`), serve-read is `withSystemContext`.** The
   `image_uploads_owner` policy exists for future owner-scoped listing/audit and to fail closed by
   default (matching `binary_refs`' V46 rationale), but the GET route's read intentionally bypasses
   it via `withSystemContext` — enforcing ownership on read would break the "public by unguessable
   id" model decision 2 relies on. This divergence (write-scoped, read-unscoped by design) is called
   out explicitly so it doesn't read as an oversight.

4. **MIME allow-list narrower than `ContentSourceSupport.ImageExtensions`, and MIME type derived from
   a local literal map — not `ImageSourceSupport.dimensionsAndMime`.** The extension allow-list is
   `{png, jpg, jpeg, gif, webp}` (`ContentSourceSupport.ImageExtensions` includes `bmp`, which this
   ticket excludes); `validateExtension(filename, allowed)` already takes an explicit
   `allowed: Set[String]` parameter, so the route passes its own narrower set. Critically,
   `ImageUploadService` does **not** reuse `ImageSourceSupport.dimensionsAndMime` for MIME
   derivation, despite the ticket's own hint to look at that file: `dimensionsAndMime` calls
   `javax.imageio.ImageIO.read`, and this JVM's stock `ImageIO` has no WebP reader
   (`ImageIO.getReaderFormatNames()` omits `"webp"`, confirmed via a probe; `backend/build.sbt` pulls
   in no WebP-capable plugin such as TwelveMonkeys) — reusing it would reject every valid `.webp`
   upload as "corrupt," even though `webp` is one of the five required allowed extensions. Instead,
   `ImageUploadService` derives `mime_type` from its own small extension-keyed literal map
   (`png -> image/png`, `jpg`/`jpeg -> image/jpeg`, `gif -> image/gif`, `webp -> image/webp`) and does
   not decode the image at all — width/height are not needed for a panel-literal upload, so no
   `ImageIO` dependency is introduced.

5. **Size limit via env var, not `application.conf`.** Every existing per-connector limit
   (`csvMaxBytes`, `textMaxBytes`, `pdfMaxBytes`, `imageMaxBytes` in `DataSourceRoutes.scala`) is
   `sys.env.get("X_MAX_FILE_SIZE_BYTES").flatMap(_.toLongOption).getOrElse(default)` — no size limit
   in this codebase lives in `application.conf` today. Following the ticket's literal wording would
   introduce a second, inconsistent config mechanism for the same kind of value. Self-approved:
   `IMAGE_UPLOAD_MAX_FILE_SIZE_BYTES`, default 10 MB (`10485760`), same route-layer-early-reject +
   service-layer-authoritative-reject pattern as the existing four.

6. **Storage path**: `images/<uuid>.<ext>` (plural — distinct from the connector's singular
   `image/<sourceId>.<ext>` prefix, avoiding any collision) documented in
   `notes/uploads-filesystem-layout.md` per the ticket's DoD.

7. **`ImagePanel.tsx` sanitizer**: extended to also accept a same-origin-relative
   `/api/uploads/image/<uuid>` path (returned as-is by the backend — no `helio://` custom scheme,
   since a literal `/api/...` path needs no browser support work and `<img src="/api/...">` already
   works unchanged). `new URL(url, window.location.origin)` replaces the current baseless
   `new URL(url)` call so both absolute `http(s)://` and root-relative paths parse; the
   protocol/allow-list check still runs against the resolved URL.

## Risks / Trade-offs

- [Unauthenticated GET serves any valid id to anyone who has it] → Acceptable: matches the
  pre-existing trust model for external image URLs (no auth today either); UUIDs are
  unguessable, and there's no sensitive data beyond the image bytes themselves.
- [New table duplicates part of `binary_refs`' shape] → Accepted per ticket guidance to reuse the
  *shape*, not the table; documented in Decision 1 to prevent a future "why two tables" bug report.

## Planner Notes (self-approved)

- Decisions 2, 3, 5, 6, 7 above are implementation-detail choices within the ticket's stated scope,
  not new external dependencies or breaking changes — self-approved, no escalation.
- Scope boundary vs. HEL-245: this change stops at "the returned URL is stored on the panel like
  any other image URL" (ticket's own wording) — Markdown-panel reference rendering is explicitly
  HEL-245's scope, per proposal.md Non-goals.
