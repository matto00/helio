# Files modified — HEL-881

- `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala` — generalised the `csvUrlFetch` seam
  to `urlFetch: (kind, url) => Future[Either[String, Array[Byte]]]`; added URL-backed `text`/`pdf`/`image` branches
  to `loadRowsWithStats` mirroring the existing `csv` branch; `image` additionally writes fetched bytes back to
  `config.path` before building its row (Decision 4). A fetch failure fails the run; no fallback to stored bytes.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — replaced `csvUrlFetchSeam` with a
  single `urlFetchSeam(kind, url)` that dispatches to `CsvUrlFetch.fetch` (csv) or
  `ContentSourceSupport.fetchUrlWithLimit` (text/pdf/image), preserving each kind's existing policy (https-only +
  non-CSV gate for csv; http-or-https + per-kind size limit for text/pdf/image).
- `backend/src/main/scala/com/helio/services/sources/ContentSourceSupport.scala` — added `textMaxBytes`/
  `pdfMaxBytes`/`imageMaxBytes` (hoisted from `DataSourceService`, same env vars/defaults) and `fetchUrlWithLimit`
  (fetch + size-check), the single fetch-and-size-check path text/pdf/image's manual-refresh and run-path seam both
  now share.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — `textMaxBytes`/`pdfMaxBytes`/
  `imageMaxBytes` now delegate to `ContentSourceSupport`'s constants instead of duplicating the env-var reads;
  behavior unchanged.
- `backend/src/main/scala/com/helio/infrastructure/storage/LocalFileSystem.scala` — `write` is now atomic: stages
  into a same-directory temp file, then `Files.move` with `ATOMIC_MOVE` + `REPLACE_EXISTING`; the temp file is
  deleted on any failure. `FileSystem` trait and `GcsFileSystem` untouched.
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineUrlRefetchSpec.scala` (new) — the task-1.2
  probe (real local HTTP server, changing bytes across two runs, hit-counter evidence ruling out a
  conditional-request short-circuit) plus coverage for pdf/image re-fetch, upload-created no-network-call,
  http-accepted, size-limit, fetch-failure-fails-run, and default-unconfigured-seam behavior.
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — updated the three existing
  CSV-seam tests' named parameter/lambda arity from `csvUrlFetch: String => ...` to `urlFetch: (String, String) => ...`
  to match the generalised engine constructor param.
- `backend/src/test/scala/com/helio/infrastructure/storage/LocalFileSystemSpec.scala` — added the atomicity guard
  (task 4.5a): a positive-evidence test that a same-directory temp file is observably staged during a large write
  (fails against a bare `Files.write` reversion — verified), and a failure-cleanup test (no leftover temp file, and
  the original directory content untouched, when the move itself fails).
- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` — added `seedTextUrlDs` plus a
  manual-`submit` test and a `previewStep` test proving a URL-backed `text` source reaches the same shared seam a
  scheduled run would (Decision 6 — the dispatch is shared across scheduled/manual/preview).

No Flyway migration added (`backend/src/main/resources/db/migration/` untouched — verified via `git status`). No
change to the `FileSystem` trait, `GcsFileSystem`, `WorkspaceContextService.scala`, `PipelineService.scala`,
`api/protocols/patchsets/**`, `helio-mcp`, the REST connector fetch path, or schema inference.
