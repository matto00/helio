# Uploads filesystem layout

Helio stores all uploaded/ingested binary content through the `FileSystem`
trait (`backend/src/main/scala/com/helio/infrastructure/FileSystem.scala`),
never via direct `java.nio.file` calls. The active implementation is selected
at startup by `HELIO_UPLOADS_BACKEND`:

- `local` (default) — `LocalFileSystem`, rooted at `HELIO_UPLOADS_ROOT`
  (falls back to the legacy `HELIO_UPLOADS_DIR`, then `~/.helio/uploads`).
- `gcs` — `GcsFileSystem`, rooted at the bucket named by
  `HELIO_UPLOADS_BUCKET`.

Every path written through `FileSystem.write` is relative to that root —
switching `HELIO_UPLOADS_BACKEND` from `local` to `gcs` (or vice versa) is a
config-only change; no code that writes or reads through `FileSystem` needs
to change.

Within that root, two independent prefixes currently exist:

| Prefix                   | Written by                                                            | Purpose                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `image/<sourceId>.<ext>` | `DataSourceService.ingestImage` (HEL-216 image data-source connector) | Pipeline-bound image _data_. Backed by a `data_sources` row + a `DataType` (with a `binary-ref` field) + a `binary_refs` (V46/HEL-217) metadata row. Readable only through the pipeline/DataType read path.                                                |
| `images/<uuid>.<ext>`    | `ImageUploadService.upload` (HEL-246 panel-literal image upload)      | Standalone image bytes referenced directly by an Image panel's `imageUrl`. Backed by its own `image_uploads` (V54) metadata row — no `DataType`/`data_sources` row at all. Served back byte-for-byte via the unauthenticated `GET /api/uploads/image/:id`. |

The prefixes are deliberately distinct (singular `image/` vs. plural
`images/`) so a HEL-216 data-source upload and a HEL-246 panel upload can
never collide on the same storage key, even though both derive their
filename from a randomly generated id plus the original file's extension.

Neither prefix reuses the other's metadata table:

- `binary_refs` (V46) is keyed on `(data_type_id, row_index, field_name)` — a
  shape that only makes sense for pipeline-bound, row-correlated content.
  It is never written to or read from by the HEL-246 upload path.
- `image_uploads` (V54) is a direct-owner table (`owner_id` column, RLS
  policy scoped straight to it) with no parent `DataType` — see
  `openspec/changes/image-upload-panel/design.md` Decision 1 for the full
  rationale on why the two were kept separate rather than forcing HEL-246
  uploads into the `binary_refs` shape.

Allowed extensions also differ slightly: the HEL-216 connector accepts
`{png, jpg, jpeg, gif, webp, bmp}` (`ContentSourceSupport.ImageExtensions`),
while the HEL-246 upload endpoint accepts the narrower `{png, jpg, jpeg, gif,
webp}` (no `bmp`) — see design.md Decision 4.
