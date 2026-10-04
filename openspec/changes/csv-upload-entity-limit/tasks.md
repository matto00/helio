## 1. Red first
- [x] 1.1 On main (before fixes) reproduce with generated temp files (never committed): 20 MiB upload to infer -> 500; ~8 MiB-edge upload -> 500; capture evidence for the PR.

## 2. Backend limits and enforcement
- [x] 2.1 `CsvLimits` object (bytes/rows/cells, env overrides, entity limit = bytes + 1 MiB) and allocation-free `check(bytes)`; unit tests incl. boundary cases and quoted newlines.
- [x] 2.2 `withSizeLimit` on the infer and multipart create routes only; map `EntityStreamSizeException` and over-limit checks to 413 `ErrorResponse`; route tests with real oversized bodies (generated at test time).
- [x] 2.3 Enforce `CsvLimits.check` in createCsv, infer, createCsvUrl, refresh, run-time CSV load, previewCsv, first-run builder; tests per site.
- [x] 2.4 Head-only `SchemaInferenceEngine.fromCsv` and `parseCsvRows`; behavior-preserving tests.
- [x] 2.5 Per-instance upload semaphore (429 + Retry-After) outside entity unmarshalling; test.
- [x] 2.6 `GET /api/data-sources/csv-limits` + schema in `schemas/` + test.

## 3. Frontend
- [x] 3.1 Fetch limits; remove `CSV_UPLOAD_MAX_BYTES`; precheck from fetched value, skip on fetch failure.
- [x] 3.2 413 clear message, no Retry; 429 retry-later; AddSourceModal and first-run drop zone.
- [x] 3.3 Fix FirstRunDropZone exact-edge test (+ tests for the new boundary and 413/no-Retry).

## 4. Verification
- [x] 4.1 Re-measure (-Xmx768m, N = cap = 2 concurrent uploads at the 15 MiB cap, plus first-run builds across cell caps 200k-750k and min-viable heap at 512m) and record numbers.
- [x] 4.2 Red/green evidence against a running backend; live UI check in light and dark themes against the running app.
- [x] 4.3 Read-only check of dev-DB CSV sources against the caps; report any over.
- [x] 4.4 `sbt testFull`, frontend lint/typecheck/tests, openspec validate.

## Standing Constraints
- [C1] Row counting treats LF, CR and CRLF as line breaks (matching the engine's `linesIterator`); add a bare-CR test.
- [C2] The upload semaphore permit is released on every completion path (success, failure, client abort) and 429 is returned before the request body is consumed.
- [C3] Verify live in the browser that the frontend surfaces the 413 message, not a generic network error.
- [C4] The PR must state that row/cell caps narrow the "up to 50 MiB succeeds" AC to "up to 15 MiB AND within 50,000 rows / 300,000 cells" (owner ruling), with measurements (design.md); SparkJobSubmitter reading CSV by path is out of scope.
- [C5] Never commit large test files; generate at test time under a temp dir and delete; never run bare `sbt test` (use `sbt testFull`), `nice -n 19`, one JVM at a time.
