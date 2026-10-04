## Why

`POST /api/data-sources/infer` and `POST /api/data-sources` sit under Pekko's 8 MiB default entity cap, so an 8-50 MiB CSV upload (which the route-level check and `CsvUrlFetch` allow) returns 500 (infer) with a generic message and a futile Retry. Measurement (design.md) also shows that simply raising the cap to 50 MiB would OOM a 1 GiB Cloud Run instance: every CSV consumer holds the whole file as rows in memory, so a narrow 50 MiB file (13M rows) OOMs upload, preview and run, and even a wide one OOMs at two concurrent runs. The URL-import path already allows 50 MiB, so production is exposed today.

## What Changes

- Set a 15 MiB (CsvLimits.maxBytes + 1 MiB multipart margin) entity limit on the two CSV multipart routes only (`POST /api/data-sources/infer`, `POST /api/data-sources`); global default untouched. Entity-too-large maps to a 413 `ErrorResponse` (never 500).
- Add measured row and cell caps (15 MiB, 50,000 rows, 300,000 cells; owner-ruled after measurement) alongside the byte cap, enforced at upload/create, infer, URL import, refresh, and defensively at run time (preview, dry run, real run, first-run builder) for already-stored oversize files: a clear failure naming the caps, never an OOM.
- Inference and preview read only a head prefix instead of splitting the whole file.
- Concurrency cap on CSV upload requests (per-instance semaphore, 429 + Retry-After).
- Backend-owned single source of truth: authenticated `GET /api/data-sources/csv-limits` returning byte, row and cell limits; the frontend drops its hard-coded 8 MiB constant and reads it.
- Frontend shows 413 (too large / too many rows) clearly with no Retry; fix the drop zone edge test.

**AC narrowing:** the ticket asked that uploads up to 50 MiB succeed. This change narrows that to "up to 15 MiB AND within 50,000 rows / 300,000 cells". Reasons (design.md): a 50 MiB file is ~13M rows when narrow, and even a dense 50 MiB file at 735k cells thrashed GC (43 full GCs, 17 s GC, 503s) with two concurrent runs at the production 768 MiB heap; the run path is bounded by cells, and 300k cells is the cap at which N=2 concurrent runs pass in a 512 MiB heap (1.5x margin). Streaming the run path (HEL-1257) is how the caps can be raised.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `csv-upload-connector`: size/row/cell limits, 413 mapping, limits endpoint, concurrency cap, head-only inference/preview.

## Impact

Backend: `DataSourceRoutes`, `DataSourcePreviewRoutes`, `DataSourceService`, `SchemaInferenceEngine`, `CsvUrlFetch`, `InProcessPipelineEngine` CSV load, first-run service. Frontend: `csvSourceCreate.ts`, `useFirstRunBuild.ts`, `AddSourceModal`, `dataSourceService.ts`, tests. Schemas: new response schema. Follow-up HEL-1257 (stream run path) lets caps be raised later.
