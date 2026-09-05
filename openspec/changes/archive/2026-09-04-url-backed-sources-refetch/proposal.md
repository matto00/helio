## Why

A URL-backed `text`, `pdf` or `image` source never re-fetches on a pipeline run. `InProcessPipelineEngine`'s
source-load dispatch reads the stored file for those three kinds unconditionally, so a scheduled pipeline processes
the bytes captured at creation time forever, runs green, and reports success. HEL-862 fixed exactly this for `csv`
by adding a `sourceUrl` branch to the CSV case; the other three kinds still have the pre-HEL-862 shape. This is a
silent-wrong-answer defect in three shipped connectors.

## What Changes

- The pipeline engine's source-load dispatch re-fetches `config.sourceUrl` for `text`, `pdf` and `image` when one is
  present, instead of reading the stored file — on every run path the dispatch serves (scheduled, manual, preview),
  not only the scheduled one named in the ticket.
- The URL-fetch seam the engine holds is generalised from a CSV-only seam to one shared entry point all four
  URL-backed kinds go through, so per-kind copies cannot drift (HEL-599's lesson, restated in this ticket's scope).
- Per-kind size limits and per-kind scheme policy are preserved exactly as the manual-refresh path already applies
  them: CSV stays https-only with its non-CSV body gate; text/pdf/image keep `ContentSourceSupport`'s existing
  http-or-https policy, which `csv-url-ingestion` explicitly requires be left unmodified.
- Sources with no `sourceUrl` (upload-created) keep reading their stored file, byte-for-byte unchanged.
- `LocalFileSystem.write` becomes atomic internally (same-directory temp file + `ATOMIC_MOVE`). This is a strict
  improvement for every existing caller — image uploads, data-source writes, and the assistant transcript writes,
  which use a write-then-record ordering a torn file would silently corrupt — not a cost paid for the image case.

## Non-goals

- No schema/Flyway migration. `sourceUrl` already exists on all three configs and is already persisted.
- No change to the REST connector fetch path, to schema inference, or to `DataSourceService.refresh` semantics.
- No caching, conditional-request (ETag/If-Modified-Since), or fetched-at bookkeeping.
- No caching layer and no fetched-at bookkeeping. (The engine DOES write refetched bytes back to storage for `image`
  alone — see design Decision 4 — because an image row references its bytes by `storageKey` rather than carrying
  them inline. `text`/`pdf`/`csv` run paths stay read-only.)

## Capabilities

### New Capabilities

- `url-backed-source-run-refresh`: on a pipeline run, a URL-backed source of any kind re-fetches its `sourceUrl`
  through one shared path rather than serving the snapshot stored at creation time.

### Modified Capabilities

- `csv-url-ingestion`: the engine-level CSV re-fetch requirement is restated as one instance of the shared
  cross-kind path rather than a CSV-only branch.

## Impact

- `backend/.../domain/engine/InProcessPipelineEngine.scala` (source-load dispatch, fetch seam signature).
- `backend/.../services/pipelines/PipelineRunService.scala` (seam wiring).
- `backend/.../services/sources/` (the shared URL-fetch helper currently named for CSV).
- `backend/.../infrastructure/storage/LocalFileSystem.scala` (atomic `write`; no `FileSystem` trait change, no GCS
  change — GCS object writes are already atomic).
- Backend tests for the engine, the run service, and the URL-fetch helper.
