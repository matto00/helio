## Context

The backend has all the infrastructure in place: `FileSystem`/`LocalFileSystem` for file storage, `SchemaInferenceEngine.fromCsv` for field inference, `DataSourceRepository` for persistence, and `DataTypeRepository` for registering the resulting type. The `ApiRoutes` currently only exposes `GET /api/data-sources`. This design adds the upload flow and the three new routes without touching the frontend.

The existing `SchemaInferenceEngine.fromCsv` uses `line.split(",", -1)` to parse rows, which breaks on quoted fields (`"Smith, John"`) and CRLF line endings. The fix is self-contained inside `SchemaInferenceEngine`.

## Goals / Non-Goals

**Goals:**
- `POST /api/data-sources` — multipart upload, infer schema, store file, register DataSource + DataType
- `POST /api/data-sources/:id/refresh` — re-parse stored file, update DataType fields
- `GET /api/data-sources/:id/preview` — first 10 rows as JSON, read-only
- `DELETE /api/data-sources/:id` — delete source record and stored file
- RFC 4180 CSV parsing (quoted fields, escaped quotes, CRLF)
- File size limit via env var, UTF-8 enforcement

**Non-Goals:**
- Frontend UI (HEL-47)
- Other source types (REST API already done in HEL-44)
- Streaming large files (50 MB limit keeps files in memory safely)
- Re-upload via refresh (refresh re-parses the already-stored file; a separate re-upload endpoint is deferred)

## Decisions

### 1. Akka HTTP `FileUpload` directive vs raw `entity(as[Multipart.FormData])`
Use the higher-level `storeUploadedFile` / `fileUpload` directives from `akka.http.scaladsl.server.directives.FileUploadDirectives`. They handle streaming, temp file creation, and cleanup automatically. We collect the bytes into memory only after the size check, keeping the route simple.

Alternative: manual `entity(as[Multipart.FormData])` — more control but verbose for this use case.

### 2. File size enforcement
Read the `Content-Length` header and reject before consuming the body when it exceeds the limit. If `Content-Length` is absent, collect bytes with an Akka Streams `take` stage and reject after accumulation. Env var: `CSV_MAX_FILE_SIZE_BYTES`, default `52428800` (50 MB).

### 3. RFC 4180 parser placement
Add a private `parseRfc4180Row(line: String): Vector[String]` helper in `SchemaInferenceEngine` and replace the `split(",", -1)` calls. The parser handles:
- Fields wrapped in double-quotes
- Escaped double-quotes inside quoted fields (`""` → `"`)
- CRLF and LF line endings (normalise to LF before splitting)

This keeps the fix isolated to `SchemaInferenceEngine` with no new dependencies.

### 4. DataType linking
On upload: create a `DataSource` with `config = {"path": "<relative-path>"}`, then create a `DataType` with `sourceId = Some(ds.id)` and fields derived from `SchemaInferenceEngine.fromCsv`. Both inserts happen sequentially; if `DataTypeRepository.insert` fails, the `DataSource` row is left orphaned (acceptable for now — no transaction wrapper yet since Slick transactions across two repos add complexity).

On refresh: load the stored path from `config`, read bytes via `FileSystem.read`, re-run inference, call `DataTypeRepository.update` with the new fields.

### 5. Preview route
`GET /api/data-sources/:id/preview` reads the file from `FileSystem`, parses up to 10 data rows, and returns them as `{"rows": [[...], ...], "headers": [...]}`. No write side effects.

### 6. Delete with file cleanup
`DELETE /api/data-sources/:id` checks `sourceType`; if `csv`, reads `config.path` and calls `FileSystem.delete`. Then deletes the `DataSource` row. File deletion failure is logged but does not fail the HTTP response — the record is still removed.

### 7. UTF-8 enforcement
Attempt `new String(bytes, StandardCharsets.UTF_8)` after byte collection, then verify the round-trip (`str.getBytes(UTF_8) sameElements bytes`) — a mismatch indicates non-UTF-8 encoding. Return 400 with a clear message.

## Risks / Trade-offs

- **In-memory accumulation**: Files up to 50 MB are held in memory during parse. With multiple concurrent uploads this could spike heap usage. Mitigation: the 50 MB cap limits worst-case exposure; streaming parse can be added later.
- **Orphaned DataSource on DataType insert failure**: Without a cross-repo transaction, a failed `DataType` insert leaves the `DataSource` row. Mitigation: the DataType insert is unlikely to fail (no uniqueness constraint) and a cleanup job can sweep orphaned sources in future.
- **No re-upload on refresh**: Refresh only re-parses the stored file. If the user wants to replace the file, they must delete and re-upload. This is a known limitation, deferred to HEL-47.
- **RFC 4180 parser**: Hand-rolled parsers can have edge cases. Mitigation: cover quoted fields, escaped quotes, empty fields, and CRLF in unit tests.
